import { z } from 'zod';

import { withRetry } from '../lib/retry.js';
import { trackError } from './errorTracker.js';

const GEOCODING_BASE_URL =
  'https://geocoding-api.open-meteo.com/v1/search';

const REQUEST_TIMEOUT_MS = 5000;

const locationSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  country: z.string().optional(),
  timezone: z.string().optional(),
});

const geocodingResponseSchema = z.object({
  results: z.array(z.unknown()).optional(),
});

async function fetchGeocodeOnce(normalizedCityName) {
  const url = new URL(GEOCODING_BASE_URL);
  url.searchParams.set('name', normalizedCityName);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `Geocoding request timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        { cause: error }
      );
    }
    throw new Error(
      `Failed to reach the geocoding service: ${
        error instanceof Error ? error.message : 'Unknown network error'
      }`,
      { cause: error }
    );
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const statusError = new Error(
      `Geocoding request failed with status ${response.status}.`
    );
    statusError.status = response.status;
    throw statusError;
  }
  let rawData;
  try {
    rawData = await response.json();
  } catch {
    throw new Error(
      'The geocoding service returned an invalid JSON response.'
    );
  }
  const responseValidation = geocodingResponseSchema.safeParse(rawData);
  if (!responseValidation.success) {
    throw new Error(
      'The geocoding service returned an invalid response structure.'
    );
  }
  const firstResult = responseValidation.data.results?.[0];
  if (!firstResult) {
    throw new Error(`No location found for "${normalizedCityName}".`);
  }
  const locationValidation = locationSchema.safeParse(firstResult);
  if (!locationValidation.success) {
    throw new Error(
      'The geocoding service returned invalid location data or coordinates.'
    );
  }
  const location = locationValidation.data;
  return {
    cityName: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    country: location.country ?? null,
    timezone: location.timezone ?? null,
  };
}

export async function geocodeCity(cityName) {
  const normalizedCityName = cityName?.trim();
  if (!normalizedCityName) {
    throw new Error('City name is required.');
  }

  let attemptsMade = 0;

  try {
    return await withRetry(
      () => {
        attemptsMade += 1;
        return fetchGeocodeOnce(normalizedCityName);
      },
      {
        onRetry: ({ error, willRetry }) => {
          if (willRetry) {
            console.warn(
              `[geocodingService] Attempt ${attemptsMade} failed, retrying:`,
              error instanceof Error ? error.message : error,
            );
          }
        },
      },
    );
  } catch (error) {
    trackError({
      service: 'geocoding',
      severity: 'warning',
      error,
      retryCount: attemptsMade - 1,
      context: { cityName: normalizedCityName },
    });
    throw error;
  }
}
