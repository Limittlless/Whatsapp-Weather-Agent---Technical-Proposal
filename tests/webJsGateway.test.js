import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWebJsProvider,
  toInternalWhatsAppId,
  toWebJsChatId,
} from '../src/gateways/webJsGateway.js';

class FakeLocalAuth {
  constructor(options) {
    this.options = options;
  }
}

function createClientHarness({ initializeError } = {}) {
  const clients = [];

  class FakeClient extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.sendMessage = vi.fn().mockResolvedValue({ id: 'sent-message' });
      this.getChatById = vi.fn().mockResolvedValue({
        sendStateTyping: vi.fn().mockResolvedValue(undefined),
      });
      this.getContactLidAndPhone = vi
        .fn()
        .mockResolvedValue([]);
      this.destroy = vi.fn().mockResolvedValue(undefined);
      clients.push(this);
    }

    async initialize() {
      if (initializeError) {
        throw initializeError;
      }
      this.emit('ready');
    }
  }

  return { FakeClient, clients };
}

function createIncomingMessage(overrides = {}) {
  return {
    from: '212600000000@c.us',
    fromMe: false,
    body: 'Hello',
    id: { _serialized: 'web-message-1' },
    getChat: vi.fn().mockResolvedValue({
      sendStateTyping: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  };
}

describe('webJsGateway ID mapping', () => {
  it('normalizes WhatsApp Web chat IDs for the shared pipeline', () => {
    expect(toInternalWhatsAppId('212600000000@c.us')).toBe(
      '212600000000',
    );
    expect(toInternalWhatsAppId('212600000000:12@c.us')).toBe(
      '212600000000',
    );
  });

  it('adds @c.us only when the recipient is not already a chat ID', () => {
    expect(toWebJsChatId('212600000000')).toBe(
      '212600000000@c.us',
    );
    expect(toWebJsChatId('123@lid')).toBe('123@lid');
  });
});

describe('createWebJsProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses LocalAuth and container-safe Puppeteer arguments', async () => {
    const { FakeClient, clients } = createClientHarness();
    const provider = createWebJsProvider(
      {
        WHATSAPP_WEB_JS_AUTH_PATH: '/sessions',
        WHATSAPP_WEB_JS_CLIENT_ID: 'weather-agent',
        PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser',
      },
      {
        ClientCtor: FakeClient,
        LocalAuthCtor: FakeLocalAuth,
      },
    );

    await provider.initialize();

    expect(clients).toHaveLength(1);
    expect(clients[0].options.authStrategy.options).toEqual({
      dataPath: '/sessions',
      clientId: 'weather-agent',
    });
    expect(clients[0].options.puppeteer).toEqual({
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    await provider.drain();
    expect(clients[0].destroy).toHaveBeenCalledTimes(1);
  });

  it('normalizes an incoming message and sends the reply to its real chat ID', async () => {
    const { FakeClient, clients } = createClientHarness();
    const processIncomingMessageFn = vi.fn(
      async (message, { sendMessageFn }) => {
        await sendMessageFn(message.whatsappId, 'Agent reply');
      },
    );
    const provider = createWebJsProvider(
      {},
      {
        ClientCtor: FakeClient,
        LocalAuthCtor: FakeLocalAuth,
        processIncomingMessageFn,
      },
    );

    await provider.initialize();
    clients[0].emit('message', createIncomingMessage());
    await provider.drain();

    expect(processIncomingMessageFn).toHaveBeenCalledWith(
      {
        whatsappId: '212600000000',
        userMessage: 'Hello',
        messageId: 'web-message-1',
      },
      { sendMessageFn: provider.sendMessage },
    );
    expect(clients[0].sendMessage).toHaveBeenCalledWith(
      '212600000000@c.us',
      'Agent reply',
    );
  });

  it('resolves an incoming LID to the phone number used by auth', async () => {
    const { FakeClient, clients } = createClientHarness();
    const processIncomingMessageFn = vi.fn(
      async (message, { sendMessageFn }) => {
        await sendMessageFn(message.whatsappId, 'Authorized reply');
      },
    );
    const provider = createWebJsProvider(
      {},
      {
        ClientCtor: FakeClient,
        LocalAuthCtor: FakeLocalAuth,
        processIncomingMessageFn,
      },
    );

    await provider.initialize();
    clients[0].getContactLidAndPhone.mockResolvedValue([
      {
        lid: '987654321@lid',
        pn: '22232651342@c.us',
      },
    ]);
    clients[0].emit(
      'message',
      createIncomingMessage({
        from: '987654321@lid',
        id: { _serialized: 'web-lid-message-1' },
      }),
    );
    await provider.drain();

    expect(clients[0].getContactLidAndPhone).toHaveBeenCalledWith([
      '987654321@lid',
    ]);
    expect(processIncomingMessageFn).toHaveBeenCalledWith(
      {
        whatsappId: '22232651342',
        userMessage: 'Hello',
        messageId: 'web-lid-message-1',
      },
      { sendMessageFn: provider.sendMessage },
    );
    expect(clients[0].sendMessage).toHaveBeenCalledWith(
      '987654321@lid',
      'Authorized reply',
    );
    await provider.drain();
  });

  it('supports a typing indicator through the incoming message chat', async () => {
    const { FakeClient, clients } = createClientHarness();
    const incoming = createIncomingMessage();
    const processIncomingMessageFn = vi.fn(
      async (message, { sendMessageFn }) => {
        await sendMessageFn.sendTypingIndicator(
          message.messageId,
          message.whatsappId,
        );
      },
    );
    const provider = createWebJsProvider(
      {},
      {
        ClientCtor: FakeClient,
        LocalAuthCtor: FakeLocalAuth,
        processIncomingMessageFn,
      },
    );

    await provider.initialize();
    clients[0].emit('message', incoming);
    await provider.drain();

    const chat = await incoming.getChat.mock.results[0].value;
    expect(chat.sendStateTyping).toHaveBeenCalledTimes(1);
  });

  it('ignores group, broadcast, self-authored, and empty messages', async () => {
    const { FakeClient, clients } = createClientHarness();
    const processIncomingMessageFn = vi.fn();
    const provider = createWebJsProvider(
      {},
      {
        ClientCtor: FakeClient,
        LocalAuthCtor: FakeLocalAuth,
        processIncomingMessageFn,
      },
    );

    await provider.initialize();
    clients[0].emit(
      'message',
      createIncomingMessage({ from: 'group@g.us' }),
    );
    clients[0].emit(
      'message',
      createIncomingMessage({ from: 'status@broadcast' }),
    );
    clients[0].emit(
      'message',
      createIncomingMessage({ fromMe: true }),
    );
    clients[0].emit(
      'message',
      createIncomingMessage({ body: '   ' }),
    );
    await provider.drain();

    expect(processIncomingMessageFn).not.toHaveBeenCalled();
  });

  it('prints QR codes without exposing them to the shared pipeline', async () => {
    const { FakeClient, clients } = createClientHarness();
    const qrCode = { generate: vi.fn() };
    const processIncomingMessageFn = vi.fn();
    const provider = createWebJsProvider(
      {},
      {
        ClientCtor: FakeClient,
        LocalAuthCtor: FakeLocalAuth,
        qrCode,
        processIncomingMessageFn,
      },
    );

    await provider.initialize();
    clients[0].emit('qr', 'qr-payload');

    expect(qrCode.generate).toHaveBeenCalledWith('qr-payload', {
      small: true,
    });
    expect(processIncomingMessageFn).not.toHaveBeenCalled();
    await provider.drain();
  });

  it('recovers when WhatsApp Web syncs but the library misses ready', async () => {
    const clients = [];
    let runRecovery;

    class MissingReadyClient extends EventEmitter {
      constructor(options) {
        super();
        this.options = options;
        this.sendMessage = vi
          .fn()
          .mockResolvedValue({ id: 'sent-message' });
        this.destroy = vi.fn().mockResolvedValue(undefined);
        this.pupPage = {
          evaluate: vi.fn().mockResolvedValue(true),
        };
        clients.push(this);
      }

      async initialize() {
        this.emit('authenticated');
      }
    }

    const setTimeoutFn = vi.fn((callback) => {
      runRecovery = callback;
      return { unref: vi.fn() };
    });
    const provider = createWebJsProvider(
      {},
      {
        ClientCtor: MissingReadyClient,
        LocalAuthCtor: FakeLocalAuth,
        setTimeoutFn,
      },
    );

    await provider.initialize();
    expect(setTimeoutFn).toHaveBeenCalledWith(
      expect.any(Function),
      3000,
    );

    await runRecovery();
    await provider.sendMessage('212600000000', 'Recovered');

    expect(clients[0].pupPage.evaluate).toHaveBeenCalledTimes(1);
    expect(clients[0].sendMessage).toHaveBeenCalledWith(
      '212600000000@c.us',
      'Recovered',
    );
    await provider.drain();
  });

  it('schedules an internal retry when initialization fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { FakeClient } = createClientHarness({
      initializeError: new Error('Chromium unavailable'),
    });
    const setTimeoutFn = vi.fn(() => ({ unref: vi.fn() }));
    const trackErrorFn = vi.fn();
    const provider = createWebJsProvider(
      { WHATSAPP_WEB_JS_RECONNECT_DELAY_MS: '2500' },
      {
        ClientCtor: FakeClient,
        LocalAuthCtor: FakeLocalAuth,
        setTimeoutFn,
        trackErrorFn,
      },
    );

    await expect(provider.initialize()).resolves.toBeUndefined();

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 2500);
    expect(trackErrorFn).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'whatsapp_web_js',
        severity: 'warning',
      }),
    );
    await provider.drain();
  });
});
