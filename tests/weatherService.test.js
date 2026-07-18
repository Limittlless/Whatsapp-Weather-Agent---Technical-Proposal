import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWeather } from '../src/services/weatherService.js';

describe('getCurrentWeather', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('returns a normalized forecast for valid coordinates', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        current: {
          time: '2026-07-18T12:00',
          temperature_2m: 32.4,
          relative_humidity_2m: 40,
          weather_code: 1,
          wind_speed_10m: 12.3,
        },
      }),
    });
    const result = await getCurrentWeather(30.4278, -9.5981);
    expect(result).toEqual({
      time: '2026-07-18T12:00',
      temperatureCelsius: 32.4,
      relativeHumidityPercent: 40,
      windSpeedKmh: 12.3,
      weatherCode: 1,
      description: 'mainly clear',
    });
  });
  it('falls back to a generic description for an unmapped weather code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        current: {
          time: '2026-07-18T12:00',
          temperature_2m: 10,
          relative_humidity_2m: 50,
          weather_code: 99,
          wind_speed_10m: 5,
        },
      }),
    });
    const result = await getCurrentWeather(30, -9);
    expect(result.description).toBe('weather code 99');
  });
  it('throws when latitude is missing or not a number', async () => {
    await expect(getCurrentWeather(undefined, -9.5981)).rejects.toThrow(
      /Invalid coordinates.*latitude/i
    );
    await expect(getCurrentWeather('30', -9.5981)).rejects.toThrow(
      /Invalid coordinates.*latitude/i
    );
  });
  it('throws when longitude is missing or not a number', async () => {
    await expect(getCurrentWeather(30.4278, undefined)).rejects.toThrow(
      /Invalid coordinates.*longitude/i
    );
  });
  it('throws when latitude is out of range', async () => {
    await expect(getCurrentWeather(120, -9.5981)).rejects.toThrow(
      'Latitude must be between -90 and 90.'
    );
  });
  it('throws when longitude is out of range', async () => {
    await expect(getCurrentWeather(30.4278, -200)).rejects.toThrow(
      'Longitude must be between -180 and 180.'
    );
  });
  it('throws when the API returns an unsuccessful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    });
    await expect(getCurrentWeather(30, -9)).rejects.toThrow(
      'Weather forecast request failed with status 500.'
    );
  });
  it('throws when the network request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network unavailable')
    );
    await expect(getCurrentWeather(30, -9)).rejects.toThrow(
      'Failed to reach the weather forecast service: Network unavailable'
    );
  });
  it('throws when the response contains invalid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    await expect(getCurrentWeather(30, -9)).rejects.toThrow(
      'The weather forecast service returned an invalid JSON response.'
    );
  });
  it('throws when the response structure is unexpected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: 'shape' }),
    });
    await expect(getCurrentWeather(30, -9)).rejects.toThrow(
      'unexpected response structure'
    );
  });
  it('aborts the request when it exceeds the timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );
    const requestPromise = getCurrentWeather(30, -9);
    const rejectionExpectation = expect(requestPromise).rejects.toThrow(
      'Weather forecast request timed out after 5000ms.'
    );
    await vi.advanceTimersByTimeAsync(5000);
    await rejectionExpectation;
  });
});
