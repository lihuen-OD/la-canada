import { countUpcomingEvents } from './eventsService';
import { countNews } from './newsService';
import { countPhotos } from './photosService';

/**
 * Subtítulos de la grilla de ☰ Más (`rndMas` del prototipo): novedades de hoy
 * o total, eventos próximos (cumpleaños incluidos) y cantidad de fotos. Una
 * sola request para toda la pantalla; solo conteos en Postgres.
 */
export async function getMoreSummary(now = new Date()) {
  const [news, upcomingEvents, photos] = await Promise.all([
    countNews(now),
    countUpcomingEvents(now),
    countPhotos(),
  ]);
  return { news, events: { upcoming: upcomingEvents }, photos: { total: photos } };
}
