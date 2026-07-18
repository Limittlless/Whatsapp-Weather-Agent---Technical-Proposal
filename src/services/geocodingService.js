const GEOCODING_BASE_URL =
  'https://geocoding-api.open-meteo.com/v1/search';

export async function geocodeCity(cityName) {
  const normalizedCityName = cityName?.trim();

  if (!normalizedCityName) {
    throw new Error('City name is required.');
  }

  const url = new URL(GEOCODING_BASE_URL);

  url.searchParams.set('name', normalizedCityName);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Failed to reach the geocoding service: ${error.message}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Geocoding request failed with status ${response.status}.`
    );
  }

  const data = await response.json();
  const location = data.results?.[0];

  if (!location) {
    throw new Error(`No location found for "${normalizedCityName}".`);
  }

  const { latitude, longitude } = location;

  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('The geocoding service returned invalid coordinates.');
  }

  return {
    cityName: location.name,
    latitude,
    longitude,
    country: location.country ?? null,
    timezone: location.timezone ?? null,
  };
}
