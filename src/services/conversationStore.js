import { z } from 'zod';
import { getSupabaseClient, withSupabaseRetry } from '../config/supabaseClient.js';

const messageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.union([z.string(), z.null()]).optional(),
    tool_calls: z.array(z.unknown()).optional(),
    tool_call_id: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

const historySchema = z.array(messageSchema);

function assertWhatsappId(whatsappId) {
  if (!whatsappId?.trim()) {
    throw new Error('whatsappId is required.');
  }
}

export async function getConversationHistory(whatsappId) {
  assertWhatsappId(whatsappId);
  const supabase = getSupabaseClient();

  const { data } = await withSupabaseRetry(
    () =>
      supabase
        .from('conversations')
        .select('history')
        .eq('whatsapp_id', whatsappId)
        .maybeSingle(),
    { operation: 'getConversationHistory', context: { whatsappId } },
  );

  if (!data) {
    return [];
  }
  const validation = historySchema.safeParse(data.history);
  if (!validation.success) {
    throw new Error(
      `Stored conversation history for "${whatsappId}" is malformed.`
    );
  }
  return validation.data;
}

export async function saveConversationHistory(
  whatsappId,
  history,
  { lock } = {},
) {
  assertWhatsappId(whatsappId);
  const validation = historySchema.safeParse(history);
  if (!validation.success) {
    throw new Error('Cannot save malformed conversation history.');
  }
  const supabase = getSupabaseClient();

  if (lock?.key && lock?.ownerId) {
    lock.assertLockHeld?.();

    try {
      await withSupabaseRetry(
        () =>
          supabase.rpc('save_conversation_history_with_lock', {
            p_whatsapp_id: whatsappId,
            p_history: validation.data,
            p_lock_key: lock.key,
            p_lock_owner_id: lock.ownerId,
          }),
        {
          operation: 'saveConversationHistoryWithLock',
          context: { whatsappId },
        },
      );
    } catch (error) {
      if (
        error?.cause?.code === 'P0001' &&
        error.cause?.message?.includes('Distributed lock')
      ) {
        error.code = 'DISTRIBUTED_LOCK_LOST';
      }
      throw error;
    }

    return;
  }

  await withSupabaseRetry(
    () =>
      supabase
        .from('conversations')
        .upsert(
          { whatsapp_id: whatsappId, history: validation.data },
          { onConflict: 'whatsapp_id' }
        ),
    { operation: 'saveConversationHistory', context: { whatsappId } },
  );
}
