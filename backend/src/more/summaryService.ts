import { countUpcomingEvents } from './eventsService';
import { countGardenPlanVersions } from './gardenService';
import { countNews } from './newsService';
import { countPhotos } from './photosService';

/**
 * Subtítulos de la grilla de ☰ Más (`rndMas` del prototipo): novedades de hoy
 * o total, eventos próximos (cumpleaños incluidos), cantidad de fotos y
 * versiones del plano (Etapa 5Y). Una sola request para toda la pantalla;
 * solo conteos en Postgres.
 */
export async function getMoreSummary(now = new Date()) {
  const [news, upcomingEvents, photos, gardenPlanVersions] = await Promise.all([
    countNews(now),
    countUpcomingEvents(now),
    countPhotos(),
    countGardenPlanVersions(),
  ]);
  return {
    news,
    events: { upcoming: upcomingEvents },
    photos: { total: photos },
    garden: { versions: gardenPlanVersions },
  };
}
