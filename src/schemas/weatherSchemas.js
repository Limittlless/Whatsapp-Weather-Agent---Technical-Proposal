import { z } from 'zod';

export const weatherToolInputSchema = z.object({
  latitude: z
    .number()
    .finite()
    .min(-90, 'Latitude must be between -90 and 90.')
    .max(90, 'Latitude must be between -90 and 90.')
    .describe('Latitude of the requested location.'),

  longitude: z
    .number()
    .finite()
    .min(-180, 'Longitude must be between -180 and 180.')
    .max(180, 'Longitude must be between -180 and 180.')
    .describe('Longitude of the requested location.'),
});

export const openMeteoCurrentWeatherResponseSchema = z.object({
  current: z.object({
    time: z.string().min(1),
    temperature_2m: z.number().finite(),
    relative_humidity_2m: z.number().finite().min(0).max(100),
    weather_code: z.number().int().min(0).max(99),
    wind_speed_10m: z.number().finite().nonnegative(),
  }),
});

export const currentWeatherResultSchema = z.object({
  time: z.string().min(1),
  temperatureCelsius: z.number().finite(),
  relativeHumidityPercent: z.number().finite().min(0).max(100),
  windSpeedKmh: z.number().finite().nonnegative(),
  weatherCode: z.number().int().min(0).max(99),
  description: z.string().min(1),
});