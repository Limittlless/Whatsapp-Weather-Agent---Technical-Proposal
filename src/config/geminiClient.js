import 'dotenv/config';
import { ChatGoogle } from '@langchain/google';

import { geocodingTool } from '../tools/geocodingTool.js';
import { weatherTool } from '../tools/weatherTool.js';

export const agentTools = [geocodingTool, weatherTool];

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
    temperature: 0.4,
  });

  return model.bindTools(agentTools);
}