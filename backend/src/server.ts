import { createApp } from './app';
import { config } from './config';
import { startDriveBackup } from './driveBackup';
import { disconnectPrisma } from './lib/prisma';

const app = createApp();

if (config.isProduction && config.trustProxyHops === 0) {
  // eslint-disable-next-line no-console -- aviso de configuración intencional
  console.warn(
    'TRUST_PROXY_HOPS=0 en producción: detrás del balanceador de Render todos los usuarios ' +
      'compartirían la misma IP en los rate limits. Ver docs/ARCHITECTURE.md §32.',
  );
}

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console -- log de arranque intencional
  console.log(`La Cañada API escuchando en el puerto ${config.port} (${config.nodeEnv})`);
});

// Copia adicional de fotos en Google Drive (opcional, desactivada por defecto).
// Retoma al arrancar lo que quedó pendiente; nunca condiciona el servidor.
const stopDriveBackup = startDriveBackup();

/**
 * Cierre ordenado: deja de aceptar conexiones HTTP nuevas y recién después
 * desconecta el cliente Prisma único (`lib/prisma.ts`) — ningún endpoint lo
 * usa todavía en esta etapa, pero el apagado ya queda contemplado para
 * cuando los servicios de la Etapa 5 lo hagan.
 */
function shutdown(signal: string): void {
  // eslint-disable-next-line no-console -- log de apagado intencional
  console.log(`Señal ${signal} recibida. Cerrando servidor...`);
  server.close((err) => {
    // Se espera poco a la copia en curso: si no termina, su reclamo vence y
    // se retoma en el próximo arranque (nunca se duplica en Drive).
    void Promise.race([
      stopDriveBackup?.(),
      new Promise((resolveWait) => setTimeout(resolveWait, 5_000).unref()),
    ])
      .catch(() => undefined)
      .then(() => disconnectPrisma())
      .finally(() => {
        if (err) {
          console.error('Error al cerrar el servidor:', err);
          process.exit(1);
        }
        process.exit(0);
      });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
