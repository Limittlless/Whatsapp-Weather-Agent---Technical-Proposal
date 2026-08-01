import 'dotenv/config';
import { ChatGoogle } from '@langchain/google';

import { weatherByLocationTool } from '../tools/weatherByLocationTool.js';

export const agentTools = [weatherByLocationTool];

export function createGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const modelName =
    process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash';

  if (!apiKey) {
    throw new Error(
      'Missing GEMINI_API_KEY. Add it to your .env file.',
    );
  }

  const model = new ChatGoogle({
    model: modelName,
    apiKey,
    reasoningEffort: 'minimal',
    maxOutputTokens: 1024,
    maxRetries: 0,
  });

  return model.bindTools(agentTools);
}
