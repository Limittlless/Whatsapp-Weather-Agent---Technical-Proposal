import { withRetry } from '../lib/retry.js';
import {
  weatherToolInputSchema,
  openMeteoCurrentWeatherResponseSchema,
  currentWeatherResultSchema,
} from '../schemas/weatherSchemas.js';
import { trackError } from './errorTracker.js';

const FORECAST_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 5000;

const WEATHER_CODE_DESCRIPTIONS = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  71: 'slight snow fall',
  73: 'moderate snow fall',
  75: 'heavy snow fall',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  95: 'thunderstorm',
};

function describeWeatherCode(code) {
  return WEATHER_CODE_DESCRIPTIONS[code] ?? `weather code ${code}`;
}

async function fetchCurrentWeatherOnce(validCoordinates) {
  const url = new URL(FORECAST_BASE_URL);
  url.searchParams.set('latitude', String(validCoordinates.latitude));
  url.searchParams.set('longitude', String(validCoordinates.longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m'
  );
  url.searchParams.set('timezone', 'auto');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `Weather forecast request timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        { cause: error }
      );
    }
    throw new Error(
      `Failed to reach the weather forecast service: ${
        error instanceof Error ? error.message : 'Unknown network error'
      }`,
      { cause: error }
    );
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const statusError = new Error(
      `Weather forecast request failed with status ${response.status}.`
    );
    statusError.status = response.status;
    throw statusError;
  }
  let rawData;
  try {
    rawData = await response.json();
  } catch {
    throw new Error(
      'The weather forecast service returned an invalid JSON response.'
    );
  }
  const validation = openMeteoCurrentWeatherResponseSchema.safeParse(rawData);
  if (!validation.success) {
    throw new Error(
      'The weather forecast service returned an unexpected response structure.'
    );
  }
  const { current } = validation.data;
  const normalizedResult = {
    time: current.time,
    temperatureCelsius: current.temperature_2m,
    relativeHumidityPercent: current.relative_humidity_2m,
    windSpeedKmh: current.wind_speed_10m,
    weatherCode: current.weather_code,
    description: describeWeatherCode(current.weather_code),
  };
  const resultValidation = currentWeatherResultSchema.safeParse(normalizedResult);
  if (!resultValidation.success) {
    throw new Error(
      'Failed to build a valid normalized weather result.'
    );
  }
  return resultValidation.data;
}

export async function getCurrentWeather(latitude, longitude) {
  const inputValidation = weatherToolInputSchema.safeParse({
    latitude,
    longitude,
  });
  if (!inputValidation.success) {
    const message = inputValidation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(' ');

    throw new Error(`Invalid coordinates: ${message}`);
  }

  const validCoordinates = inputValidation.data;
  let attemptsMade = 0;

  try {
    return await withRetry(
      () => {
        attemptsMade += 1;
        return fetchCurrentWeatherOnce(validCoordinates);
      },
      {
        onRetry: ({ error, willRetry }) => {
          if (willRetry) {
            console.warn(
              `[weatherService] Attempt ${attemptsMade} failed, retrying:`,
              error instanceof Error ? error.message : error,
            );
          }
        },
      },
    );
  } catch (error) {
    trackError({
      service: 'weather',
      severity: 'warning',
      error,
      retryCount: attemptsMade - 1,
      context: { latitude: validCoordinates.latitude, longitude: validCoordinates.longitude },
    });
    throw error;
  }
}
