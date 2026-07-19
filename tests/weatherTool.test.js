import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/services/weatherService.js', () => ({
  getCurrentWeather: vi.fn(),
}));

import { getCurrentWeather } from '../src/services/weatherService.js';
import { weatherTool } from '../src/tools/weatherTool.js';

describe('weatherTool', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });
  it('has the name and description Gemini needs to decide when to call it', () => {
    expect(weatherTool.name).toBe('get_current_weather');
    expect(weatherTool.description).toMatch(/geocode_location/);
  });
  it('rejects input missing latitude/longitude', async () => {
    await expect(weatherTool.invoke({})).rejects.toThrow();
    expect(getCurrentWeather).not.toHaveBeenCalled();
  });
  it('rejects out-of-range coordinates before calling the service', async () => {
    await expect(
      weatherTool.invoke({ latitude: 200, longitude: 0 })
    ).rejects.toThrow();
    expect(getCurrentWeather).not.toHaveBeenCalled();
  });
  it('calls getCurrentWeather and returns the result as JSON', async () => {
    getCurrentWeather.mockResolvedValue({
      time: '2026-07-18T12:00',
      temperatureCelsius: 32.4,
      relativeHumidityPercent: 40,
      windSpeedKmh: 12.3,
      weatherCode: 1,
      description: 'mainly clear',
    });
    const result = await weatherTool.invoke({
      latitude: 30.4278,
      longitude: -9.5981,
    });
    expect(getCurrentWeather).toHaveBeenCalledWith(30.4278, -9.5981);
    expect(JSON.parse(result)).toEqual({
      time: '2026-07-18T12:00',
      temperatureCelsius: 32.4,
      relativeHumidityPercent: 40,
      windSpeedKmh: 12.3,
      weatherCode: 1,
      description: 'mainly clear',
    });
  });
  it('returns a JSON error payload instead of throwing when the service fails', async () => {
    getCurrentWeather.mockRejectedValue(
      new Error('Weather forecast request failed with status 500.')
    );
    const result = await weatherTool.invoke({
      latitude: 30.4278,
      longitude: -9.5981,
    });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toMatch(/status 500/);
  });
});
