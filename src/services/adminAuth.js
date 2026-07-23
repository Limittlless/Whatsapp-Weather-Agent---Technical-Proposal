function normalize(number) {
  return String(number ?? '').trim();
}

export function getAdminNumbers(env = process.env) {
  const raw = env.ADMIN_WHATSAPP_NUMBERS ?? '';

  return raw
    .split(',')
    .map((n) => normalize(n))
    .filter((n) => n.length > 0);
}

export function isAdminNumber(whatsappId, env = process.env) {
  const normalized = normalize(whatsappId);

  if (!normalized) {
    return false;
  }

  return getAdminNumbers(env).includes(normalized);
}
