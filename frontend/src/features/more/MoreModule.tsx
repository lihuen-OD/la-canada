import { lazy, Suspense, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingState } from '../../components/ui/StateMessage';
import { RequireRole } from '../../routes/RequireRole';
import { AccessDeniedScreen } from '../admin/AccessDeniedScreen';
import { MoreHome } from './MoreHome';
import { NewsScreen } from './NewsScreen';
import { EventsScreen } from './EventsScreen';
import { WeatherScreen } from './WeatherScreen';
import { ProfileScreen } from './ProfileScreen';

/** Carga diferida: galería (visor, subida, carga perezosa de imágenes) y Configuración (solo ADMIN). */
const PhotosScreen = lazy(() => import('./PhotosScreen'));
const SettingsScreen = lazy(() => import('./SettingsScreen'));
const TeamScreen = lazy(() => import('./TeamScreen'));

const fallback = <LoadingState label="Cargando…" />;
const adminOnly = (element: ReactElement) => (
  <RequireRole role="ADMIN" fallback={<AccessDeniedScreen />}>
    <Suspense fallback={fallback}>{element}</Suspense>
  </RequireRole>
);

/**
 * ☰ Más (`pg-mas` del prototipo) y sus submódulos como rutas descendientes
 * SPA: `/more` (grilla), 📝 `/more/news`, 📅 `/more/events`, 🌤️
 * `/more/weather`, 📸 `/more/photos`, ⚙️ `/more/settings` y 👤
 * `/more/settings/team` (ADMIN) y 👤 `/more/profile` (empleado).
 */
export function MoreModule() {
  return (
    <Routes>
      <Route index element={<MoreHome />} />
      <Route path="news" element={<NewsScreen />} />
      <Route path="events" element={<EventsScreen />} />
      <Route path="weather" element={<WeatherScreen />} />
      <Route
        path="photos"
        element={
          <Suspense fallback={fallback}>
            <PhotosScreen />
          </Suspense>
        }
      />
      <Route path="settings" element={adminOnly(<SettingsScreen />)} />
      <Route path="settings/team" element={adminOnly(<TeamScreen />)} />
      <Route path="profile" element={<ProfileScreen />} />
      <Route path="*" element={<Navigate to="/more" replace />} />
    </Routes>
  );
}
