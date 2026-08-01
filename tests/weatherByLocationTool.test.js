import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/geocodingService.js', () => ({
  geocodeCity: vi.fn(),
}));

vi.mock('../src/services/weatherService.js', () => ({
  getCurrentWeather: vi.fn(),
}));

import { geocodeCity } from '../src/services/geocodingService.js';
import { getCurrentWeather } from '../src/services/weatherService.js';
import { weatherByLocationTool } from '../src/tools/weatherByLocationTool.js';

describe('weatherByLocationTool', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('geocodes and fetches weather in one tool invocation', async () => {
    geocodeCity.mockResolvedValue({
      cityName: 'Agadir',
      latitude: 30.4278,
      longitude: -9.5981,
      country: 'Morocco',
      timezone: 'Africa/Casablanca',
    });
    getCurrentWeather.mockResolvedValue({
      time: '2026-08-01T14:00',
      temperatureCelsius: 27,
      relativeHumidityPercent: 58,
      windSpeedKmh: 14,
      weatherCode: 1,
      description: 'mainly clear',
    });

    const result = JSON.parse(
      await weatherByLocationTool.invoke({ location: 'Agadir' }),
    );

    expect(weatherByLocationTool.name).toBe('get_weather_for_location');
    expect(geocodeCity).toHaveBeenCalledWith('Agadir');
    expect(getCurrentWeather).toHaveBeenCalledWith(30.4278, -9.5981);
    expect(result.location.cityName).toBe('Agadir');
    expect(result.weather.temperatureCelsius).toBe(27);
  });

  it('returns an error without calling weather when geocoding fails', async () => {
    geocodeCity.mockRejectedValue(new Error('No location found.'));

    const result = JSON.parse(
      await weatherByLocationTool.invoke({ location: 'Unknown' }),
    );

    expect(result.error).toBe(true);
    expect(result.message).toMatch(/No location found/);
    expect(getCurrentWeather).not.toHaveBeenCalled();
  });
});
