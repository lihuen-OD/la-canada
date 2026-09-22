import { AppProviders } from './app/AppProviders';
import { AppRoutes } from './routes/AppRoutes';

export function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
