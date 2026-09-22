import { createApp } from './app';
import { config } from './config';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console -- log de arranque intencional
  console.log(`La Cañada API escuchando en el puerto ${config.port} (${config.nodeEnv})`);
});

function shutdown(signal: string): void {
  // eslint-disable-next-line no-console -- log de apagado intencional
  console.log(`Señal ${signal} recibida. Cerrando servidor...`);
  server.close((err) => {
    if (err) {
      console.error('Error al cerrar el servidor:', err);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
