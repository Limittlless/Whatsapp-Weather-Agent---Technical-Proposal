import { z } from 'zod';

import {
  getSupabaseClient,
  withSupabaseRetry,
} from '../config/supabaseClient.js';

const AUTHORIZED_USER_FIELDS =
  'whatsapp_id,display_name,active,authorized_by,authorized_at,revoked_by,revoked_at';
const MAX_LISTED_USERS = 30;

const authorizedUserSchema = z.object({
  whatsapp_id: z.string(),
  display_name: z.string().nullable().optional(),
  active: z.boolean(),
  authorized_by: z.string(),
  authorized_at: z.string(),
  revoked_by: z.string().nullable().optional(),
  revoked_at: z.string().nullable().optional(),
});

export function normalizeWhatsappId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\s()+-]/g, '');

  if (!/^\d{7,15}$/.test(normalized)) {
    throw new Error(
      'WhatsApp ID must contain 7 to 15 digits, optionally prefixed with "+".'
    );
  }

  return normalized;
}

function normalizeDisplayName(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > 80) {
    throw new Error('Display name must be 80 characters or fewer.');
  }

  return normalized;
}

function validateAuthorizedUser(data) {
  const validation = authorizedUserSchema.safeParse(data);

  if (!validation.success) {
    throw new Error('Supabase returned a malformed authorized-user record.');
  }

  return validation.data;
}

export async function getAuthorizedUser(whatsappId) {
  const normalizedId = normalizeWhatsappId(whatsappId);
  const supabase = getSupabaseClient();

  const { data } = await withSupabaseRetry(
    () =>
      supabase
        .from('authorized_users')
        .select(AUTHORIZED_USER_FIELDS)
        .eq('whatsapp_id', normalizedId)
        .maybeSingle(),
    {
      operation: 'getAuthorizedUser',
      context: { whatsappId: normalizedId },
    }
  );

  return data ? validateAuthorizedUser(data) : null;
}

export async function isUserAuthorized(whatsappId) {
  const user = await getAuthorizedUser(whatsappId);
  return user?.active === true;
}

export async function authorizeUser({
  whatsappId,
  displayName,
  authorizedBy,
}) {
  const normalizedId = normalizeWhatsappId(whatsappId);
  const normalizedAdminId = normalizeWhatsappId(authorizedBy);
  const normalizedDisplayName = normalizeDisplayName(displayName);
  const authorizedAt = new Date().toISOString();
  const supabase = getSupabaseClient();

  const record = {
    whatsapp_id: normalizedId,
    display_name: normalizedDisplayName,
    active: true,
    authorized_by: normalizedAdminId,
    authorized_at: authorizedAt,
    revoked_by: null,
    revoked_at: null,
  };

  await withSupabaseRetry(
    () =>
      supabase
        .from('authorized_users')
        .upsert(record, { onConflict: 'whatsapp_id' }),
    {
      operation: 'authorizeUser',
      context: {
        whatsappId: normalizedId,
        authorizedBy: normalizedAdminId,
      },
    }
  );

  return record;
}

export async function revokeUser({ whatsappId, revokedBy }) {
  const normalizedId = normalizeWhatsappId(whatsappId);
  const normalizedAdminId = normalizeWhatsappId(revokedBy);
  const supabase = getSupabaseClient();

  const { count } = await withSupabaseRetry(
    () =>
      supabase
        .from('authorized_users')
        .update(
          {
            active: false,
            revoked_by: normalizedAdminId,
            revoked_at: new Date().toISOString(),
          },
          { count: 'exact' }
        )
        .eq('whatsapp_id', normalizedId)
        .eq('active', true),
    {
      operation: 'revokeUser',
      context: {
        whatsappId: normalizedId,
        revokedBy: normalizedAdminId,
      },
    }
  );

  return (count ?? 0) > 0;
}

export async function listAuthorizedUsers({ limit = MAX_LISTED_USERS } = {}) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || MAX_LISTED_USERS, 1),
    MAX_LISTED_USERS
  );
  const supabase = getSupabaseClient();

  const { data } = await withSupabaseRetry(
    () =>
      supabase
        .from('authorized_users')
        .select(AUTHORIZED_USER_FIELDS)
        .eq('active', true)
        .order('authorized_at', { ascending: false })
        .limit(safeLimit),
    {
      operation: 'listAuthorizedUsers',
      context: { limit: safeLimit },
    }
  );

  return (data ?? []).map(validateAuthorizedUser);
}
