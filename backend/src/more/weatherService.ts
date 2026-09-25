import { z } from 'zod';
import { config } from '../config';
import { NotFoundError, WeatherUnavailableError } from '../errors/AppError';
import { prisma } from '../lib/prisma';

/**
 * 🌤️ Clima (docs/BUSINESS_RULES.md §20). El prototipo llamaba a Open-Meteo
 * desde el navegador con coordenadas fijas; ahora lo hace el backend con la
 * ubicación real (`PropertyLocation "main"`, sembrada con Villa Elisa) — el
 * frontend no conoce ningún servicio externo. Mismas variables, textos,
 * íconos y reglas de recomendación del prototipo (`rndClima`).
 *
 * Caché en memoria del proceso (no es un dato personal: es el mismo para
 * todos) durante 10 minutos, con una sola petición en vuelo: muchos usuarios
 * abriendo Clima generan a lo sumo un request a Open-Meteo por ventana.
 */

const CACHE_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const FORECAST_DAYS = 5;

/** `WD` del prototipo. */
const DESCRIPTIONS: Record<number, string> = {
  0: 'Despejado',
  1: 'Mayorm. despejado',
  2: 'Parcialm. nublado',
  3: 'Nublado',
  45: 'Niebla',
  48: 'Niebla',
  51: 'Llovizna leve',
  53: 'Llovizna',
  55: 'Llovizna intensa',
  61: 'Lluvia leve',
  63: 'Lluvia moderada',
  65: 'Lluvia intensa',
  71: 'Nieve leve',
  73: 'Nieve',
  75: 'Nieve intensa',
  80: 'Chaparrones',
  81: 'Chaparrones',
  82: 'Chaparrones fuertes',
  95: 'Tormenta',
  96: 'Tormenta+granizo',
  99: 'Tormenta fuerte',
};

/** `WI` del prototipo. */
const ICONS: Record<number, string> = {
  0: '☀️',
  1: '🌤️',
  2: '⛅',
  3: '☁️',
  45: '🌫️',
  48: '🌫️',
  51: '🌦️',
  53: '🌦️',
  55: '🌧️',
  61: '🌦️',
  63: '🌧️',
  65: '🌧️',
  71: '🌨️',
  73: '❄️',
  75: '❄️',
  80: '🌦️',
  81: '🌧️',
  82: '⛈️',
  95: '⛈️',
  96: '⛈️',
  99: '⛈️',
};

export const describeWeather = (code: number) => DESCRIPTIONS[code] ?? 'Variable';
export const weatherIcon = (code: number) => ICONS[code] ?? '🌡️';

const openMeteoSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    apparent_temperature: z.number(),
    precipitation: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number(),
  }),
  daily: z.object({
    time: z.array(z.string()).min(2),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_sum: z.array(z.number()),
    precipitation_probability_max: z.array(z.number().nullable()),
  }),
});
type OpenMeteoResponse = z.infer<typeof openMeteoSchema>;

export interface GardenRecommendation {
  icon: string;
  text: string;
}

/** Reglas fijas de `rndClima` (mismo orden y umbrales). */
export function gardenRecommendations(data: OpenMeteoResponse): GardenRecommendation[] {
  const max = data.daily.temperature_2m_max[0] ?? 0;
  const rainToday = (data.daily.precipitation_sum[0] ?? 0) > 1;
  const rainTomorrow = (data.daily.precipitation_sum[1] ?? 0) > 1;
  const wind = data.current.wind_speed_10m;
  const recommendations: GardenRecommendation[] = [];
  if (rainToday) recommendations.push({ icon: '🚫', text: 'No regar hoy — lluvia suficiente' });
  else if (!rainTomorrow) {
    recommendations.push({ icon: '💧', text: 'Regar hoy — no se esperan lluvias' });
  }
  if (rainTomorrow) {
    recommendations.push({ icon: '⏸️', text: 'No fumigar — lluvia prevista mañana' });
  }
  if (max > 32) {
    recommendations.push({ icon: '🌡️', text: 'Calor intenso — regar temprano a la mañana' });
  }
  if (wind > 25)
    recommendations.push({ icon: '💨', text: 'Viento fuerte — evitar fumigación hoy' });
  if (max < 10) recommendations.push({ icon: '🥶', text: 'Frío — proteger plantas sensibles' });
  if (!recommendations.length) {
    recommendations.push({ icon: '✅', text: 'Condiciones favorables para el jardín' });
  }
  return recommendations;
}

export function buildWeatherReport(label: string, data: OpenMeteoResponse, fetchedAt: Date) {
  const { current, daily } = data;
  return {
    location: { label },
    current: {
      temperature: Math.round(current.temperature_2m),
      apparentTemperature: Math.round(current.apparent_temperature),
      humidity: Math.round(current.relative_humidity_2m),
      windSpeed: Math.round(current.wind_speed_10m),
      raining: current.precipitation > 0,
      description: describeWeather(current.weather_code),
      icon: weatherIcon(current.weather_code),
    },
    forecast: daily.time.slice(0, FORECAST_DAYS).map((date, index) => ({
      date,
      icon: weatherIcon(daily.weather_code[index] ?? -1),
      max: Math.round(daily.temperature_2m_max[index] ?? 0),
      min: Math.round(daily.temperature_2m_min[index] ?? 0),
      precipitationProbability: daily.precipitation_probability_max[index] ?? null,
    })),
    recommendations: gardenRecommendations(data),
    fetchedAt: fetchedAt.toISOString(),
  };
}

export type WeatherReport = ReturnType<typeof buildWeatherReport>;

type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
let cached: { report: WeatherReport; expiresAt: number } | null = null;
let inFlight: Promise<WeatherReport> | null = null;

/** Solo tests: reemplaza el `fetch` saliente y vacía la caché. */
export function setWeatherFetcherForTests(next: Fetcher | null): void {
  fetcher = next ?? ((url, init) => fetch(url, init));
  cached = null;
  inFlight = null;
}

async function fetchReport(now: Date): Promise<WeatherReport> {
  const location = await prisma.propertyLocation.findUnique({
    where: { code: 'main' },
    select: { label: true, latitude: true, longitude: true },
  });
  if (!location) throw new NotFoundError('No hay una ubicación configurada para el clima.');
  const params = new URLSearchParams({
    latitude: location.latitude.toString(),
    longitude: location.longitude.toString(),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    timezone: config.businessTimeZone,
    forecast_days: String(FORECAST_DAYS),
  });
  let payload: unknown;
  try {
    const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch (error) {
    console.error('Open-Meteo no respondió:', error instanceof Error ? error.message : error);
    throw new WeatherUnavailableError();
  }
  const parsed = openMeteoSchema.safeParse(payload);
  if (!parsed.success) throw new WeatherUnavailableError();
  return buildWeatherReport(location.label, parsed.data, now);
}

export async function getWeather(now = new Date()): Promise<WeatherReport> {
  if (cached && cached.expiresAt > now.getTime()) return cached.report;
  if (!inFlight) {
    inFlight = fetchReport(now)
      .then((report) => {
        cached = { report, expiresAt: now.getTime() + CACHE_TTL_MS };
        return report;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
