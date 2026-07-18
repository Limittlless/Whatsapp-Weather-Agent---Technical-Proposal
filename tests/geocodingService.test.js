import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodeCity } from '../src/services/geocodingService.js';

describe('geocodeCity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns validated coordinates for a valid city', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            name: 'Marrakesh',
            latitude: 31.63416,
            longitude: -7.99994,
            country: 'Morocco',
            timezone: 'Africa/Casablanca',
          },
        ],
      }),
    });

    const result = await geocodeCity('Marrakesh');

    expect(result).toEqual({
      cityName: 'Marrakesh',
      latitude: 31.63416,
      longitude: -7.99994,
      country: 'Morocco',
      timezone: 'Africa/Casablanca',
    });
  });

  it('trims the city name before sending the request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            name: 'Cairo',
            latitude: 30.0444,
            longitude: 31.2357,
          },
        ],
      }),
    });

    await geocodeCity('  Cairo  ');

    const requestedUrl = fetchMock.mock.calls[0][0];

    expect(requestedUrl.searchParams.get('name')).toBe('Cairo');
  });

  it('throws when the city name is empty', async () => {
    await expect(geocodeCity('   ')).rejects.toThrow(
      'City name is required.'
    );
  });

  it('throws when no location is found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
      }),
    });

    await expect(geocodeCity('UnknownCity')).rejects.toThrow(
      'No location found'
    );
  });

  it('throws when coordinates are not numbers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            name: 'Cairo',
            latitude: '30.0',
            longitude: null,
          },
        ],
      }),
    });

    await expect(geocodeCity('Cairo')).rejects.toThrow(
      'invalid coordinates'
    );
  });

  it('throws when coordinates are outside valid ranges', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            name: 'Invalid City',
            latitude: 100,
            longitude: 200,
          },
        ],
      }),
    });

    await expect(geocodeCity('Invalid City')).rejects.toThrow(
      'invalid coordinates'
    );
  });

  it('throws when the API returns an unsuccessful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(geocodeCity('Cairo')).rejects.toThrow(
      'Geocoding request failed with status 500.'
    );
  });

  it('throws when the network request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network unavailable')
    );

    await expect(geocodeCity('Cairo')).rejects.toThrow(
      'Failed to reach the geocoding service'
    );
  });
});
