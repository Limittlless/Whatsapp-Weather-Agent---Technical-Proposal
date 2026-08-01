import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';

import { geocodeCity } from '../services/geocodingService.js';
import { getCurrentWeather } from '../services/weatherService.js';

const weatherByLocationInputSchema = z.object({
  location: z
    .string()
    .min(1)
    .describe(
      'The city or place name in its common English/Latin-script spelling. ' +
        'Translate or transliterate non-Latin user input before calling.',
    ),
});

export const weatherByLocationTool = new DynamicStructuredTool({
  name: 'get_weather_for_location',
  description:
    'Gets the current weather for a named city or place. It resolves the ' +
    'location to coordinates and fetches temperature, humidity, wind, and ' +
    'conditions in one call. Use this for named-place weather questions.',
  schema: weatherByLocationInputSchema,
  func: async ({ location }) => {
    try {
      const resolvedLocation = await geocodeCity(location);
      const weather = await getCurrentWeather(
        resolvedLocation.latitude,
        resolvedLocation.longitude,
      );

      return JSON.stringify({
        location: resolvedLocation,
        weather,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return JSON.stringify({
        error: true,
        message: `Could not get weather for "${location}": ${message}`,
      });
    }
  },
});
