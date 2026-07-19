import crypto from 'node:crypto';

export function createMetaSignatureVerifier(appSecret) {
  return function verifyMetaSignature(req, res, next) {
    if (!appSecret?.trim()) {
      return next();
    }

    const signatureHeader = req.get('x-hub-signature-256');

    if (!signatureHeader || !req.rawBody) {
      console.error(
        '[webhook] Rejected request: missing X-Hub-Signature-256 header or raw body.'
      );
      return res.sendStatus(401);
    }

    const expectedSignature =
      'sha256=' +
      crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');

    const providedBuffer = Buffer.from(signatureHeader);
    const expectedBuffer = Buffer.from(expectedSignature);

    const isValid =
      providedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedBuffer);

    if (!isValid) {
      console.error('[webhook] Rejected request: invalid X-Hub-Signature-256.');
      return res.sendStatus(401);
    }

    return next();
  };
}
