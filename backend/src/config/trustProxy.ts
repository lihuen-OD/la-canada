import type { Express } from 'express';

/**
 * Etapa 5R — de dónde sale `req.ip`, la clave de los rate limits (general,
 * imágenes, health y auth) y lo que se audita como IP de una sesión.
 *
 * Express lee `X-Forwarded-For` de derecha a izquierda y confía en tantas
 * entradas como proxies se le declaren. Cada proxy AGREGA a la derecha la IP
 * de quien le habló; lo que está a la izquierda lo pudo escribir cualquiera.
 * Por eso se declara un número exacto de saltos y nunca `true`:
 *
 * - `0` (por defecto): no se confía en la cabecera; `req.ip` es el socket.
 *   Correcto en local y en tests. Detrás del balanceador de Render agruparía
 *   a TODOS los usuarios bajo la IP del balanceador.
 * - `1`: un proxy propio (el balanceador de Render). `req.ip` es la IP que
 *   ese proxy vio conectarse: el navegador si llega directo a Render, o el
 *   proxy de Netlify si el frontend reenvía `/api` por Netlify (en ese caso
 *   agrupa por salida de Netlify, pero nadie puede falsificarla).
 * - `2`: Netlify + Render. `req.ip` es el cliente real, pero SOLO es seguro si
 *   el backend no es alcanzable sin pasar por Netlify: pegándole directo a la
 *   URL de Render, un cliente puede anteponer una IP inventada.
 *
 * La topología real todavía no está fijada (ver docs/ARCHITECTURE.md §32,
 * "IP detrás de proxies"): el valor lo decide `TRUST_PROXY_HOPS` al desplegar.
 */
export function configureTrustProxy(app: Express, hops: number): void {
  app.set('trust proxy', hops);
}
