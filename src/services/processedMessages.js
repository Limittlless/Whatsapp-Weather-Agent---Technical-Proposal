import { getSupabaseClient } from '../config/supabaseClient.js';

const DUPLICATE_KEY_ERROR_CODE = '23505';

export async function claimMessage(messageId, whatsappId) {
  if (!messageId?.trim()) {
    return true;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('processed_messages')
    .insert({ message_id: messageId, whatsapp_id: whatsappId });

  if (!error) {
    return true;
  }

  if (error.code === DUPLICATE_KEY_ERROR_CODE) {
    return false;
  }

  console.error(
    '[dedup] Failed to record processed message id:',
    error.message
  );
  return true;
}
