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

/** Carga diferida: Fotos (carpetas, galería, visor, subida) y Configuración (solo ADMIN). */
const PhotosHome = lazy(() => import('./PhotosHome'));
const PhotosScreen = lazy(() => import('./PhotosScreen'));
const GardenScreen = lazy(() => import('./GardenScreen'));
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
 * `/more/weather`, 📸 `/more/photos` (carpetas) con `/more/photos/all`,
 * `/more/photos/to-organize` (la anterior `/more/photos/unfiled` redirige) y
 * `/more/photos/folders/:folderId`, 🌳 `/more/garden`, ⚙️
 * `/more/settings` y 👤 `/more/settings/team` (ADMIN) y 👤 `/more/profile`
 * (equipo y ADMIN, 5F). Jardín no es una ruta por rol: la pantalla es la misma
 * para todos y solo aparece "Publicar" al ADMIN.
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
            <PhotosHome />
          </Suspense>
        }
      />
      <Route
        path="photos/all"
        element={
          <Suspense fallback={fallback}>
            <PhotosScreen scope="all" />
          </Suspense>
        }
      />
      <Route
        path="photos/to-organize"
        element={
          <Suspense fallback={fallback}>
            <PhotosScreen scope="none" />
          </Suspense>
        }
      />
      <Route path="photos/unfiled" element={<Navigate to="/more/photos/to-organize" replace />} />
      <Route
        path="photos/folders/:folderId"
        element={
          <Suspense fallback={fallback}>
            <PhotosScreen />
          </Suspense>
        }
      />
      <Route
        path="garden"
        element={
          <Suspense fallback={fallback}>
            <GardenScreen />
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
