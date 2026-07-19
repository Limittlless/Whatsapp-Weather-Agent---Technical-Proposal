import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudApiSender } from '../src/gateways/cloudApiClient.js';

describe('createCloudApiSender', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('throws when phoneNumberId is missing', () => {
    expect(() => createCloudApiSender({ accessToken: 'token' })).toThrow(
      'phoneNumberId is required'
    );
  });

  it('throws when accessToken is missing', () => {
    expect(() =>
      createCloudApiSender({ phoneNumberId: '123' })
    ).toThrow('accessToken is required');
  });

  it('sends a message with the correct payload and headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.123' }] }),
    });

    const sendMessage = createCloudApiSender({
      phoneNumberId: '1234567890',
      accessToken: 'test-access-token',
    });

    const result = await sendMessage('212600000000', 'Hello there');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe(
      'https://graph.facebook.com/v20.0/1234567890/messages'
    );
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-access-token');
    expect(JSON.parse(options.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '212600000000',
      type: 'text',
      text: { body: 'Hello there' },
    });
    expect(result).toEqual({ messages: [{ id: 'wamid.123' }] });
  });

  it('throws when the recipient is missing', async () => {
    const sendMessage = createCloudApiSender({
      phoneNumberId: '123',
      accessToken: 'token',
    });

    await expect(sendMessage('', 'Hello')).rejects.toThrow(
      'recipient WhatsApp ID is required'
    );
  });

  it('throws when the message body is empty', async () => {
    const sendMessage = createCloudApiSender({
      phoneNumberId: '123',
      accessToken: 'token',
    });

    await expect(sendMessage('212600000000', '   ')).rejects.toThrow(
      'non-empty message body is required'
    );
  });

  it('throws when the Cloud API returns an error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error": "Invalid token"}',
    });

    const sendMessage = createCloudApiSender({
      phoneNumberId: '123',
      accessToken: 'bad-token',
    });

    await expect(sendMessage('212600000000', 'Hi')).rejects.toThrow(
      'WhatsApp Cloud API request failed with status 401'
    );
  });

  it('throws when the network request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network unavailable')
    );

    const sendMessage = createCloudApiSender({
      phoneNumberId: '123',
      accessToken: 'token',
    });

    await expect(sendMessage('212600000000', 'Hi')).rejects.toThrow(
      'Failed to reach the WhatsApp Cloud API: Network unavailable'
    );
  });

  it('aborts the request when it exceeds the timeout', async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const sendMessage = createCloudApiSender({
      phoneNumberId: '123',
      accessToken: 'token',
    });

    const sendPromise = sendMessage('212600000000', 'Hi');
    const rejectionExpectation = expect(sendPromise).rejects.toThrow(
      'timed out after 8000ms'
    );

    await vi.advanceTimersByTimeAsync(8000);
    await rejectionExpectation;
  });
});
