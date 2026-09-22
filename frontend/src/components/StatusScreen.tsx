import { getAppEnv } from '../config/env';

/**
 * Pantalla técnica temporal de la Etapa 1: solo confirma que la nueva
 * arquitectura está operativa. No muestra personas, tareas, stock ni
 * ningún dato del negocio — será reemplazada en etapas futuras. El estilo
 * vive en styles/global.css (no reconstruye el diseño del prototipo).
 */
export function StatusScreen() {
  const env = getAppEnv();

  return (
    <main className="status-screen">
      <h1 className="status-screen__title">La Cañada</h1>
      <p className="status-screen__badge" role="status">
        Frontend operativo
      </p>
      <p className="status-screen__env">Entorno: {env.mode}</p>
    </main>
  );
}
