/**
 * Claves `Idempotency-Key` del frontend (Etapa 5C.2). Una clave identifica
 * UNA intención de registrar un movimiento: el mismo envío (doble clic,
 * reintento manual del mismo formulario fallido, reintento técnico tras
 * refresh) reutiliza la clave y el backend responde el replay en lugar de
 * crear un segundo movimiento. Cualquier cambio semántico del formulario es
 * una intención nueva y recibe otra clave.
 *
 * Las claves viven solo en memoria del componente que las creó: nunca en
 * `localStorage`/`sessionStorage`/IndexedDB, nunca en el body, nunca en
 * pantalla.
 */

/**
 * 128 bits de `crypto.getRandomValues` (Web Crypto, CSPRNG del navegador) en
 * hexadecimal: 32 caracteres, dentro del formato del backend
 * `^[A-Za-z0-9_-]{8,64}$`. Nunca `Math.random`.
 */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Huella de la intención: destino (producto) + cada campo semántico del
 * body, en orden fijo. Dos envíos con la misma huella son el mismo intento.
 */
export function intentFingerprint(target: string, body: object): string {
  const entries = Object.entries(body)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([target, entries]);
}

/**
 * Administra la clave de un formulario: `keyFor` devuelve la clave vigente si
 * la huella no cambió, o una nueva si cambió (o si no había). `discard` la
 * olvida (éxito definitivo, cancelación, conflicto o cambio de payload).
 */
export class IdempotencyIntent {
  private current: { key: string; fingerprint: string } | null = null;

  keyFor(fingerprint: string): string {
    if (this.current?.fingerprint === fingerprint) return this.current.key;
    this.current = { key: newIdempotencyKey(), fingerprint };
    return this.current.key;
  }

  discard(): void {
    this.current = null;
  }

  get hasPending(): boolean {
    return this.current !== null;
  }
}
