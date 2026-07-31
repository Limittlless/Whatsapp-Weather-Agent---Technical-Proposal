import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCESS_CHECK_FAILED_MESSAGE,
  ACCESS_DENIED_MESSAGE,
  PROCESSING_FAILED_MESSAGE,
  processIncomingMessage,
} from '../src/agent/messagePipeline.js';

function createMessage(overrides = {}) {
  return {
    whatsappId: '212600000000',
    userMessage: 'Hello',
    messageId: 'message-1',
    ...overrides,
  };
}

function createDependencies(overrides = {}) {
  return {
    runAgentFn: vi.fn().mockResolvedValue('Agent reply'),
    sendMessageFn: vi.fn().mockResolvedValue(undefined),
    claimMessageFn: vi.fn().mockResolvedValue(true),
    isAuthorizedFn: vi.fn().mockResolvedValue(true),
    isAdminNumberFn: vi.fn().mockReturnValue(false),
    executeAdminCommandFn: vi.fn(),
    ...overrides,
  };
}

describe('processIncomingMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores incomplete messages', async () => {
    const deps = createDependencies();

    await processIncomingMessage(
      createMessage({ userMessage: '   ' }),
      deps,
    );

    expect(deps.claimMessageFn).not.toHaveBeenCalled();
    expect(deps.runAgentFn).not.toHaveBeenCalled();
  });

  it('requires a sender for a valid message', async () => {
    const deps = createDependencies({ sendMessageFn: undefined });

    await expect(
      processIncomingMessage(createMessage(), deps),
    ).rejects.toThrow('sendMessageFn is required');
  });

  it('skips a message that was already claimed', async () => {
    const deps = createDependencies({
      claimMessageFn: vi.fn().mockResolvedValue(false),
    });

    await processIncomingMessage(createMessage(), deps);

    expect(deps.claimMessageFn).toHaveBeenCalledWith(
      'message-1',
      '212600000000',
    );
    expect(deps.runAgentFn).not.toHaveBeenCalled();
    expect(deps.sendMessageFn).not.toHaveBeenCalled();
  });

  it('executes an admin command without invoking the agent', async () => {
    const deps = createDependencies({
      isAdminNumberFn: vi.fn().mockReturnValue(true),
      executeAdminCommandFn: vi.fn().mockResolvedValue('Admin reply'),
    });

    await processIncomingMessage(
      createMessage({ userMessage: '/auth list' }),
      deps,
    );

    expect(deps.executeAdminCommandFn).toHaveBeenCalledWith('/auth list', {
      adminWhatsappId: '212600000000',
    });
    expect(deps.runAgentFn).not.toHaveBeenCalled();
    expect(deps.sendMessageFn).toHaveBeenCalledWith(
      '212600000000',
      'Admin reply',
    );
  });

  it('rejects an unauthorized non-admin user', async () => {
    const deps = createDependencies({
      isAuthorizedFn: vi.fn().mockResolvedValue(false),
    });

    await processIncomingMessage(createMessage(), deps);

    expect(deps.runAgentFn).not.toHaveBeenCalled();
    expect(deps.sendMessageFn).toHaveBeenCalledWith(
      '212600000000',
      ACCESS_DENIED_MESSAGE,
    );
  });

  it('fails closed when the authorization lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = createDependencies({
      isAuthorizedFn: vi.fn().mockRejectedValue(new Error('database down')),
    });

    await processIncomingMessage(createMessage(), deps);

    expect(deps.runAgentFn).not.toHaveBeenCalled();
    expect(deps.sendMessageFn).toHaveBeenCalledWith(
      '212600000000',
      ACCESS_CHECK_FAILED_MESSAGE,
    );
  });

  it('runs the agent and exposes provider-neutral typing context', async () => {
    const typingIndicator = vi.fn().mockResolvedValue(undefined);
    const sendMessageFn = vi.fn().mockResolvedValue(undefined);
    sendMessageFn.sendTypingIndicator = typingIndicator;
    const deps = createDependencies({ sendMessageFn });

    await processIncomingMessage(createMessage(), deps);

    expect(typingIndicator).toHaveBeenCalledWith(
      'message-1',
      '212600000000',
    );
    expect(deps.runAgentFn).toHaveBeenCalledWith({
      whatsappId: '212600000000',
      userMessage: 'Hello',
    });
    expect(sendMessageFn).toHaveBeenCalledWith(
      '212600000000',
      'Agent reply',
    );
  });

  it('keeps refreshing the typing indicator while the reply is still generating', async () => {
    const typingIndicator = vi.fn().mockResolvedValue(undefined);
    const sendMessageFn = vi.fn().mockResolvedValue(undefined);
    sendMessageFn.sendTypingIndicator = typingIndicator;

    let resolveAgent;
    const agentPromise = new Promise((resolve) => {
      resolveAgent = resolve;
    });

    const deps = createDependencies({
      sendMessageFn,
      runAgentFn: vi.fn().mockReturnValue(agentPromise),
      typingIndicatorRefreshMs: 10,
    });

    const processingPromise = processIncomingMessage(
      createMessage(),
      deps,
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    const callsWhileGenerating = typingIndicator.mock.calls.length;
    expect(callsWhileGenerating).toBeGreaterThan(1);

    resolveAgent('Agent reply');
    await processingPromise;

    const callsAfterReply = typingIndicator.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(typingIndicator.mock.calls.length).toBe(callsAfterReply);
  });

  it('stops refreshing the typing indicator if the agent throws', async () => {
    const typingIndicator = vi.fn().mockResolvedValue(undefined);
    const sendMessageFn = vi.fn().mockResolvedValue(undefined);
    sendMessageFn.sendTypingIndicator = typingIndicator;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const deps = createDependencies({
      sendMessageFn,
      runAgentFn: vi.fn().mockRejectedValue(new Error('boom')),
      typingIndicatorRefreshMs: 10,
    });

    await processIncomingMessage(createMessage(), deps);

    const callsAfterFailure = typingIndicator.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(typingIndicator.mock.calls.length).toBe(callsAfterFailure);
  });

  it('sends a retry reply after an unexpected processing failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = createDependencies({
      runAgentFn: vi.fn().mockRejectedValue(new Error('lock timeout')),
    });

    await processIncomingMessage(createMessage(), deps);

    expect(deps.sendMessageFn).toHaveBeenCalledWith(
      '212600000000',
      PROCESSING_FAILED_MESSAGE,
    );
  });
});