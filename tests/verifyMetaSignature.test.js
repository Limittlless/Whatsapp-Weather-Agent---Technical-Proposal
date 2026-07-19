import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMetaSignatureVerifier } from '../src/middleware/verifyMetaSignature.js';

function buildReqRes({ rawBody, signatureHeader } = {}) {
  const req = {
    rawBody,
    get: vi.fn((header) => {
      if (header.toLowerCase() === 'x-hub-signature-256') {
        return signatureHeader;
      }
      return undefined;
    }),
  };
  const res = {
    sendStatus: vi.fn(),
  };
  const next = vi.fn();
  return { req, res, next };
}

function signPayload(appSecret, rawBody) {
  return (
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
  );
}

describe('createMetaSignatureVerifier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('skips verification when no appSecret is configured', () => {
    const middleware = createMetaSignatureVerifier(undefined);
    const { req, res, next } = buildReqRes();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  it('calls next() when the signature is valid', () => {
    const appSecret = 'test-app-secret';
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signatureHeader = signPayload(appSecret, rawBody);

    const middleware = createMetaSignatureVerifier(appSecret);
    const { req, res, next } = buildReqRes({ rawBody, signatureHeader });

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.sendStatus).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the signature is wrong', () => {
    const appSecret = 'test-app-secret';
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signatureHeader = signPayload('a-different-secret', rawBody);

    const middleware = createMetaSignatureVerifier(appSecret);
    const { req, res, next } = buildReqRes({ rawBody, signatureHeader });

    middleware(req, res, next);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the signature header is missing', () => {
    const appSecret = 'test-app-secret';
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));

    const middleware = createMetaSignatureVerifier(appSecret);
    const { req, res, next } = buildReqRes({ rawBody, signatureHeader: undefined });

    middleware(req, res, next);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the raw body is missing', () => {
    const appSecret = 'test-app-secret';
    const signatureHeader = signPayload(appSecret, Buffer.from('{}'));

    const middleware = createMetaSignatureVerifier(appSecret);
    const { req, res, next } = buildReqRes({ rawBody: undefined, signatureHeader });

    middleware(req, res, next);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
