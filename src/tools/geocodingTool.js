import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { geocodeCity } from '../services/geocodingService.js';

const geocodingToolInputSchema = z.object({
  location: z
    .string()
    .min(1)
    .describe(
      'The city or place name to look up, exactly as mentioned by the ' +
        'user (e.g. "Rabat", "Marrakesh", "New York").'
    ),
});

export const geocodingTool = new DynamicStructuredTool({
  name: 'geocode_location',
  description:
    'Converts a city or place name into latitude/longitude coordinates, ' +
    'plus its country and timezone. Call this first whenever a user asks ' +
    'about the weather in a named place, before calling any weather tool ' +
    '— the weather tool needs coordinates, not a place name.',
  schema: geocodingToolInputSchema,
  func: async ({ location }) => {
    try {
      const result = await geocodeCity(location);
      return JSON.stringify(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        error: true,
        message: `Could not resolve "${location}" to a location: ${message}`,
      });
    }
  },
});
