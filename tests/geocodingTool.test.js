import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/services/geocodingService.js', () => ({
  geocodeCity: vi.fn(),
}));

import { geocodeCity } from '../src/services/geocodingService.js';
import { geocodingTool } from '../src/tools/geocodingTool.js';

describe('geocodingTool', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });
  it('has the name and description Gemini needs to decide when to call it', () => {
    expect(geocodingTool.name).toBe('geocode_location');
    expect(geocodingTool.description).toMatch(/latitude\/longitude/i);
  });
  it('rejects input missing the required "location" field', async () => {
    await expect(geocodingTool.invoke({})).rejects.toThrow();
    expect(geocodeCity).not.toHaveBeenCalled();
  });
  it('calls geocodeCity with the location and returns the result as JSON', async () => {
    geocodeCity.mockResolvedValue({
      cityName: 'Agadir',
      latitude: 30.4278,
      longitude: -9.5981,
      country: 'Morocco',
      timezone: 'Africa/Casablanca',
    });
    const result = await geocodingTool.invoke({ location: 'Agadir' });
    expect(geocodeCity).toHaveBeenCalledWith('Agadir');
    expect(JSON.parse(result)).toEqual({
      cityName: 'Agadir',
      latitude: 30.4278,
      longitude: -9.5981,
      country: 'Morocco',
      timezone: 'Africa/Casablanca',
    });
  });
  it('returns a JSON error payload instead of throwing when geocoding fails', async () => {
    geocodeCity.mockRejectedValue(
      new Error('No location found for "Notarealplace".')
    );
    const result = await geocodingTool.invoke({ location: 'Notarealplace' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toMatch(/Notarealplace/);
    expect(parsed.message).toMatch(/No location found/);
  });
  it('never throws past the tool boundary, even on an unexpected error', async () => {
    geocodeCity.mockRejectedValue('a non-Error rejection');
    const result = await geocodingTool.invoke({ location: 'Agadir' });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toMatch(/a non-Error rejection/);
  });
});
