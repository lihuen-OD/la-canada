import { useQuery } from '@tanstack/react-query';
import { fetchWeather } from '../../api/moreApi';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { errorMessageOf } from '../pets/petErrors';
import { MoreBackLink } from './MoreBackLink';
import { dateParts } from './moreLabels';

/** Igual que la caché del backend: el clima no cambia minuto a minuto. */
const WEATHER_STALE_MS = 10 * 60_000;

/**
 * 🌤️ Clima (`pg-clima`): clima actual, pronóstico de 5 días y
 * recomendaciones de jardín. El backend consulta Open-Meteo con la ubicación
 * real y calcula las recomendaciones; el navegador no llama a servicios
 * externos.
 */
export function WeatherScreen() {
  const { userId, enabled } = useSessionScope();
  const query = useQuery({
    queryKey: queryKeys.more.weather(userId),
    queryFn: fetchWeather,
    enabled,
    staleTime: WEATHER_STALE_MS,
  });
  const report = query.data;

  return (
    <div className="more">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">🌤️ </span>Clima — Entre Ríos
          </>
        }
        refreshing={Boolean(report) && query.isFetching}
        actions={<MoreBackLink />}
      />
      {!report ? (
        query.isError ? (
          <ErrorState
            title="No se pudo cargar el clima"
            description={errorMessageOf(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <LoadingState label="Cargando clima…" />
        )
      ) : (
        <>
          <Card>
            <div className="weather-now">
              <span className="weather-now__icon" aria-hidden="true">
                {report.current.icon}
              </span>
              <p className="weather-now__temp">
                {report.current.temperature}°<span className="visually-hidden"> C</span>
              </p>
              <p className="weather-now__desc">{report.current.description}</p>
              <p className="weather-now__loc">
                <span aria-hidden="true">📍 </span>
                {report.location.label}
              </p>
            </div>
            <dl className="weather-stats">
              <div className="weather-stat">
                <dd>
                  <span aria-hidden="true">💧 </span>
                  {report.current.humidity}%
                </dd>
                <dt>Humedad</dt>
              </div>
              <div className="weather-stat">
                <dd>
                  <span aria-hidden="true">🌡️ </span>
                  {report.current.apparentTemperature}°
                </dd>
                <dt>Sensación</dt>
              </div>
              <div className="weather-stat">
                <dd>
                  <span aria-hidden="true">💨 </span>
                  {report.current.windSpeed} km/h
                </dd>
                <dt>Viento</dt>
              </div>
            </dl>
            {report.current.raining ? (
              <p className="notice notice--info weather-alert" role="status">
                <span aria-hidden="true">🌧️</span>
                <span>
                  <b>Lluvia actual</b> — considerá posponer riego y fumigación
                </span>
              </p>
            ) : null}
          </Card>

          <h2 className="more__section-title">Pronóstico 5 días</h2>
          <Card>
            <ol className="forecast" aria-label="Pronóstico 5 días">
              {report.forecast.map((day, index) => (
                <li key={day.date} className="forecast__day">
                  <span className="forecast__label">
                    {index === 0 ? 'Hoy' : dateParts(day.date).weekdayShort}
                  </span>
                  <span className="forecast__icon" aria-hidden="true">
                    {day.icon}
                  </span>
                  <span className="forecast__temps">
                    {day.max}°/{day.min}°
                  </span>
                  {day.precipitationProbability !== null && day.precipitationProbability > 20 ? (
                    <span className="forecast__rain">
                      <span aria-hidden="true">💧</span>
                      {day.precipitationProbability}%
                      <span className="visually-hidden"> de lluvia</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>

          <Card
            title={
              <>
                <span aria-hidden="true">🌱 </span>Recomendaciones de jardín
              </>
            }
          >
            <ul className="garden-tips">
              {report.recommendations.map((tip) => (
                <li key={tip.text} className="garden-tip">
                  <span aria-hidden="true">{tip.icon}</span>
                  <span>{tip.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
