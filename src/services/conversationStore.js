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

export async function saveConversationHistory(whatsappId, history) {
  assertWhatsappId(whatsappId);
  const validation = historySchema.safeParse(history);
  if (!validation.success) {
    throw new Error('Cannot save malformed conversation history.');
  }
  const supabase = getSupabaseClient();

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

  return true;
}
