import whatsappWeb from 'whatsapp-web.js';
import qrCodeTerminal from 'qrcode-terminal';

import {
  processIncomingMessage as defaultProcessIncomingMessage,
} from '../agent/messagePipeline.js';
import { trackError as defaultTrackError } from '../services/errorTracker.js';

const { Client: DefaultClient, LocalAuth: DefaultLocalAuth } = whatsappWeb;

const DEFAULT_AUTH_PATH = '.wwebjs_auth';
const DEFAULT_RECONNECT_DELAY_MS = 10_000;
const READY_RECOVERY_DELAY_MS = 3_000;
const WEB_JS_SUFFIX = '@c.us';

function parseReconnectDelay(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_RECONNECT_DELAY_MS;
}

export function toInternalWhatsAppId(chatId) {
  const rawId = String(chatId ?? '').trim();
  const localPart = rawId.split('@', 1)[0];
  return localPart.split(':', 1)[0];
}

export function toWebJsChatId(whatsappId) {
  const normalized = String(whatsappId ?? '').trim();

  if (!normalized) {
    return '';
  }

  return normalized.includes('@') ? normalized : `${normalized}${WEB_JS_SUFFIX}`;
}

export function createWebJsProvider(
  env = process.env,
  {
    ClientCtor = DefaultClient,
    LocalAuthCtor = DefaultLocalAuth,
    qrCode = qrCodeTerminal,
    processIncomingMessageFn = defaultProcessIncomingMessage,
    trackErrorFn = defaultTrackError,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  const authPath =
    env.WHATSAPP_WEB_JS_AUTH_PATH?.trim() || DEFAULT_AUTH_PATH;
  const reconnectDelayMs = parseReconnectDelay(
    env.WHATSAPP_WEB_JS_RECONNECT_DELAY_MS,
  );

  const activeTasks = new Set();
  const recipientIds = new Map();
  const messageContexts = new Map();

  let client = null;
  let startPromise = null;
  let reconnectTimer = null;
  let readyRecoveryTimer = null;
  let readyRecoveryAttempted = false;
  let isReady = false;
  let isStopping = false;

  function reportLifecycleError(error, event) {
    console.error(`[webJsGateway] ${event}:`, error);
    trackErrorFn({
      service: 'whatsapp_web_js',
      severity: 'warning',
      error,
      context: { event },
    });
  }

  function resolveRecipientId(to) {
    const rawRecipient = String(to ?? '').trim();
    return recipientIds.get(rawRecipient) ?? toWebJsChatId(rawRecipient);
  }

  function createClient() {
    const localAuthOptions = { dataPath: authPath };
    const clientId = env.WHATSAPP_WEB_JS_CLIENT_ID?.trim();

    if (clientId) {
      localAuthOptions.clientId = clientId;
    }

    const puppeteer = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    const executablePath = env.PUPPETEER_EXECUTABLE_PATH?.trim();

    if (executablePath) {
      puppeteer.executablePath = executablePath;
    }

    return new ClientCtor({
      authStrategy: new LocalAuthCtor(localAuthOptions),
      puppeteer,
    });
  }

  async function safeDestroy(instance) {
    if (!instance) {
      return;
    }

    instance.removeAllListeners?.();

    try {
      await instance.destroy();
    } catch (error) {
      console.warn(
        '[webJsGateway] Failed to destroy the previous client cleanly:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  function scheduleReconnect(reason) {
    if (isStopping || reconnectTimer) {
      return;
    }

    console.warn(
      `[webJsGateway] Reconnecting in ${reconnectDelayMs}ms (${reason}).`,
    );

    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      startClient().catch((error) => {
        reportLifecycleError(error, 'Reconnect attempt failed');
        scheduleReconnect('retry after initialization failure');
      });
    }, reconnectDelayMs);
    reconnectTimer.unref?.();
  }

  function clearReadyRecoveryTimer() {
    if (!readyRecoveryTimer) {
      return;
    }

    clearTimeoutFn(readyRecoveryTimer);
    readyRecoveryTimer = null;
  }

  async function recoverMissedReadyEvent(instance) {
    if (
      isStopping ||
      isReady ||
      instance !== client ||
      !instance.pupPage?.evaluate
    ) {
      return;
    }

    try {
      const recovered = await instance.pupPage.evaluate(() => {
        const socket = window
          .require?.('WAWebSocketModel')
          ?.Socket;
        const messages = window
          .require?.('WAWebCollections')
          ?.Msg;
        const canRecover =
          socket?.state === 'CONNECTED' &&
          socket?.hasSynced === true &&
          typeof window.WWebJS !== 'undefined' &&
          typeof window.onAddMessageEvent === 'function' &&
          typeof messages?.on === 'function';

        if (!canRecover) {
          return false;
        }

        if (!window.__weatherAgentMessageForwarder) {
          const forward = (message) => {
            if (!message?.isNewMsg) {
              return;
            }

            const deliver = (currentMessage) => {
              window.onAddMessageEvent(
                window.WWebJS.getMessageModel(currentMessage),
              );
            };

            if (message.type !== 'ciphertext') {
              deliver(message);
              return;
            }

            message.once('change:type', (changedMessage) => {
              if (changedMessage.type !== 'revoked') {
                deliver(changedMessage);
              }
            });
          };

          messages.on('add', forward);
          window.__weatherAgentMessageForwarder = forward;
        }

        return true;
      });

      if (
        !recovered ||
        isStopping ||
        isReady ||
        instance !== client
      ) {
        return;
      }

      console.warn(
        '[webJsGateway] Recovering WhatsApp Web message events and readiness.',
      );
      instance.emit('ready');
    } catch (error) {
      reportLifecycleError(error, 'Ready event recovery failed');
    }
  }

  function scheduleReadyRecovery(instance) {
    if (isStopping || isReady || readyRecoveryAttempted) {
      return;
    }

    readyRecoveryAttempted = true;
    readyRecoveryTimer = setTimeoutFn(() => {
      readyRecoveryTimer = null;
      void recoverMissedReadyEvent(instance);
    }, READY_RECOVERY_DELAY_MS);
    readyRecoveryTimer.unref?.();
  }

  async function resolveIncomingWhatsAppId(sourceId, instance) {
    const fallbackId = toInternalWhatsAppId(sourceId);

    if (!sourceId.endsWith('@lid')) {
      return fallbackId;
    }

    if (typeof instance.getContactLidAndPhone !== 'function') {
      console.warn(
        `[webJsGateway] Received a @lid id (${sourceId}) but this ` +
          'whatsapp-web.js client has no getContactLidAndPhone method. ' +
          `Falling back to the raw lid (${fallbackId}) — this will NOT ` +
          'match a phone-number-based entry in ADMIN_WHATSAPP_NUMBERS or ' +
          'authorized_users. Update whatsapp-web.js to a version that ' +
          'supports lid resolution.',
      );
      return fallbackId;
    }

    try {
      const mappings = await instance.getContactLidAndPhone([
        sourceId,
      ]);
      const phoneChatId = mappings?.[0]?.pn;
      const resolvedId = toInternalWhatsAppId(phoneChatId);

      if (!resolvedId) {
        console.warn(
          `[webJsGateway] Could not resolve @lid (${sourceId}) to a phone ` +
            `number (got: ${JSON.stringify(mappings)}). Falling back to ` +
            `the raw lid (${fallbackId}) — this will NOT match a ` +
            'phone-number-based entry in ADMIN_WHATSAPP_NUMBERS or ' +
            'authorized_users. The contact may not be synced yet.',
        );
        return fallbackId;
      }

      return resolvedId;
    } catch (error) {
      console.warn(
        `[webJsGateway] Failed to resolve @lid (${sourceId}) to a phone ` +
          `number. Falling back to the raw lid (${fallbackId}):`,
        error instanceof Error ? error.message : error,
      );
      return fallbackId;
    }
  }

  function trackIncomingMessage(message, instance) {
    if (isStopping || instance !== client || message?.fromMe) {
      return;
    }

    const sourceId = String(message?.from ?? '');

    if (sourceId.endsWith('@g.us') || sourceId.endsWith('@broadcast')) {
      return;
    }

    const fallbackWhatsAppId = toInternalWhatsAppId(sourceId);
    const userMessage = message?.body;
    const messageId = message?.id?._serialized;

    if (!fallbackWhatsAppId || !userMessage?.trim()) {
      return;
    }

    const task = Promise.resolve()
      .then(async () => {
        const whatsappId = await resolveIncomingWhatsAppId(
          sourceId,
          instance,
        );

        if (!whatsappId) {
          return;
        }

        recipientIds.set(whatsappId, sourceId);
        if (messageId) {
          messageContexts.set(messageId, message);
        }

        return processIncomingMessageFn(
          { whatsappId, userMessage, messageId },
          { sendMessageFn: sendMessage },
        );
      })
      .catch((error) => {
        reportLifecycleError(error, 'Incoming message task failed');
      });

    activeTasks.add(task);
    task.finally(() => {
      activeTasks.delete(task);
      if (messageId) {
        messageContexts.delete(messageId);
      }
    });
  }

  function bindClientEvents(instance) {
    instance.on('qr', (qr) => {
      if (instance !== client || isStopping) {
        return;
      }

      console.log('[webJsGateway] Scan this QR code to link WhatsApp:');
      try {
        qrCode.generate(qr, { small: true });
      } catch (error) {
        reportLifecycleError(error, 'Failed to render QR code');
      }
    });

    instance.on('ready', () => {
      if (instance !== client || isStopping || isReady) {
        return;
      }
      isReady = true;
      clearReadyRecoveryTimer();
      console.log('[webJsGateway] WhatsApp Web client is ready.');
    });

    instance.on('authenticated', () => {
      if (instance === client && !isStopping) {
        console.log('[webJsGateway] WhatsApp Web session authenticated.');
        scheduleReadyRecovery(instance);
      }
    });

    instance.on('auth_failure', (message) => {
      if (instance !== client || isStopping) {
        return;
      }
      isReady = false;
      reportLifecycleError(
        new Error(String(message || 'Authentication failed.')),
        'Authentication failure',
      );
      scheduleReconnect('authentication failure');
    });

    instance.on('disconnected', (reason) => {
      if (instance !== client || isStopping) {
        return;
      }
      isReady = false;
      console.warn(`[webJsGateway] Client disconnected: ${reason}`);
      scheduleReconnect('client disconnected');
    });

    instance.on('message', (message) => {
      trackIncomingMessage(message, instance);
    });
  }

  async function startFreshClient() {
    if (isStopping) {
      return;
    }

    if (reconnectTimer) {
      clearTimeoutFn(reconnectTimer);
      reconnectTimer = null;
    }
    clearReadyRecoveryTimer();
    readyRecoveryAttempted = false;

    const previousClient = client;
    client = null;
    isReady = false;
    await safeDestroy(previousClient);

    if (isStopping) {
      return;
    }

    const nextClient = createClient();
    client = nextClient;
    bindClientEvents(nextClient);

    try {
      await nextClient.initialize();
    } catch (error) {
      if (nextClient === client && !isStopping) {
        reportLifecycleError(error, 'Client initialization failed');
        scheduleReconnect('initialization failure');
      }
    }
  }

  async function startClient() {
    if (isStopping || isReady) {
      return;
    }

    if (startPromise) {
      return startPromise;
    }

    const pendingStart = startFreshClient();
    startPromise = pendingStart;

    try {
      await pendingStart;
    } catch (error) {
      if (!isStopping) {
        reportLifecycleError(error, 'Client startup failed');
        scheduleReconnect('startup failure');
      }
    } finally {
      if (startPromise === pendingStart) {
        startPromise = null;
      }
    }
  }

  async function rawSend(to, body) {
    if (!String(to ?? '').trim()) {
      throw new Error('A recipient WhatsApp ID is required.');
    }

    if (!body?.trim()) {
      throw new Error('A non-empty message body is required.');
    }

    if (!client || !isReady) {
      throw new Error('The WhatsApp Web client is not ready.');
    }

    return client.sendMessage(resolveRecipientId(to), body);
  }

  async function sendMessage(to, body) {
    try {
      return await rawSend(to, body);
    } catch (error) {
      trackErrorFn({
        service: 'whatsapp',
        severity: 'critical',
        error,
        retryCount: 0,
        context: { provider: 'web_js', to },
      });
      throw error;
    }
  }

  async function sendTypingIndicator(messageId, whatsappId) {
    if (!client || !isReady) {
      return;
    }

    try {
      const sourceMessage = messageContexts.get(messageId);
      const chat = sourceMessage?.getChat
        ? await sourceMessage.getChat()
        : await client.getChatById(resolveRecipientId(whatsappId));
      await chat.sendStateTyping();
    } catch (error) {
      console.warn(
        '[webJsGateway] Failed to send typing indicator:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  sendMessage.sendTypingIndicator = sendTypingIndicator;
  sendMessage.rawSend = rawSend;

  return {
    name: 'web_js',
    sendMessage,
    attachTo() {},
    async initialize() {
      isStopping = false;
      await startClient();
    },
    async drain() {
      isStopping = true;

      if (reconnectTimer) {
        clearTimeoutFn(reconnectTimer);
        reconnectTimer = null;
      }
      clearReadyRecoveryTimer();

      await Promise.allSettled(Array.from(activeTasks));

      const activeClient = client;
      client = null;
      isReady = false;
      await safeDestroy(activeClient);
      await Promise.resolve(startPromise).catch(() => {});

      recipientIds.clear();
      messageContexts.clear();
    },
  };
}