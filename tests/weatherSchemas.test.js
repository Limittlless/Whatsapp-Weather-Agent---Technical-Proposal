import { describe, expect, it } from 'vitest';

import {
  currentWeatherResultSchema,
  openMeteoCurrentWeatherResponseSchema,
  weatherToolInputSchema,
} from '../src/schemas/weatherSchemas.js';

describe('weatherToolInputSchema', () => {
  it('accepts valid coordinates', () => {
    const result = weatherToolInputSchema.safeParse({
      latitude: 31.6295,
      longitude: -7.9811,
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid latitude', () => {
    const result = weatherToolInputSchema.safeParse({
      latitude: 100,
      longitude: -7.9811,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an invalid longitude', () => {
    const result = weatherToolInputSchema.safeParse({
      latitude: 31.6295,
      longitude: 200,
    });

    expect(result.success).toBe(false);
  });

  it('rejects coordinates with incorrect types', () => {
    const result = weatherToolInputSchema.safeParse({
      latitude: '31.6295',
      longitude: -7.9811,
    });

    expect(result.success).toBe(false);
  });
});

describe('openMeteoCurrentWeatherResponseSchema', () => {
  it('accepts a valid Open-Meteo current-weather response', () => {
    const result = openMeteoCurrentWeatherResponseSchema.safeParse({
      current: {
        time: '2026-07-18T16:00',
        temperature_2m: 31.5,
        relative_humidity_2m: 40,
        weather_code: 1,
        wind_speed_10m: 12.4,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects a malformed Open-Meteo response', () => {
    const result = openMeteoCurrentWeatherResponseSchema.safeParse({
      current: {
        temperature_2m: '31.5',
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('currentWeatherResultSchema', () => {
  it('accepts a normalized weather result', () => {
    const result = currentWeatherResultSchema.safeParse({
      time: '2026-07-18T16:00',
      temperatureCelsius: 31.5,
      relativeHumidityPercent: 40,
      windSpeedKmh: 12.4,
      weatherCode: 1,
      description: 'mainly clear',
    });

    expect(result.success).toBe(true);
  });
});