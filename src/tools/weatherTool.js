import { DynamicStructuredTool } from '@langchain/core/tools';
import { getCurrentWeather } from '../services/weatherService.js';
import { weatherToolInputSchema } from '../schemas/weatherSchemas.js';

export const weatherTool = new DynamicStructuredTool({
  name: 'get_current_weather',
  description:
    'Gets the current weather (temperature, humidity, wind, conditions) ' +
    'for a specific latitude/longitude. Requires coordinates — call ' +
    'geocode_location first to turn a place name into coordinates.',
  schema: weatherToolInputSchema,
  func: async ({ latitude, longitude }) => {
    try {
      const result = await getCurrentWeather(latitude, longitude);
      return JSON.stringify(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        error: true,
        message: `Could not get the weather for (${latitude}, ${longitude}): ${message}`,
      });
    }
  },
});
