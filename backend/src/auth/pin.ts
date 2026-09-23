import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

/**
 * Política de PIN — exactamente 4 dígitos numéricos, sin excepciones
 * (`^\d{4}$`). No es "una contraseña corta con otro nombre": un PIN de 4
 * dígitos tiene solo 10.000 combinaciones posibles, y esa menor entropía se
 * compensa del lado del servidor con rate limiting + bloqueo persistente
 * por intentos fallidos (ver `authService.login`), nunca aflojando el
 * hashing ni la comparación segura. El PIN es siempre un `string`, nunca un
 * número — un valor como `'0007'` debe preservarse tal cual (`Number('0007')`
 * perdería el cero inicial); esta función nunca transforma su entrada,
 * solo la valida.
 */
export const PIN_PATTERN = /^\d{4}$/;

export type PinValidationResult = { ok: true } | { ok: false; reason: string };

/** Pura — no toca argon2 ni la base, para poder testearla sin dependencias. */
export function validatePinPolicy(pin: string): PinValidationResult {
  if (typeof pin !== 'string') {
    return { ok: false, reason: 'El PIN debe ser una cadena de texto.' };
  }
  if (!PIN_PATTERN.test(pin)) {
    return { ok: false, reason: 'El PIN debe tener exactamente 4 dígitos (0-9).' };
  }
  return { ok: true };
}

/**
 * Parámetros Argon2id recomendados por OWASP (Password Storage Cheat
 * Sheet, primera opción): m=19456 KiB (~19 MiB), t=2, p=1. Un solo lugar
 * para estos valores — si se ajustan alguna vez, hashes viejos se siguen
 * verificando igual (Argon2 codifica sus propios parámetros en el hash).
 * Los mismos parámetros que se usaban para contraseñas: Argon2id no se
 * "abarata" solo porque la entrada sea corta — el costo del hash es
 * independiente de la longitud del PIN y es la defensa real contra fuerza
 * bruta offline si el hash llegara a filtrarse.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Lanza si el PIN no cumple la política — nunca hashea un PIN inválido. */
export async function hashPin(pin: string): Promise<string> {
  const validation = validatePinPolicy(pin);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }
  return argon2.hash(pin, ARGON2_OPTIONS);
}

/** Comparación segura vía argon2.verify (constant-time internamente). Nunca lanza — un hash corrupto es simplemente "no coincide". */
export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}

/**
 * Hash dummy — calculado una sola vez, en el primer uso, a partir de bytes
 * aleatorios (nunca de un PIN real ni de un valor fijo como "1234"). Se
 * verifica contra él cuando el usuario no existe, no tiene `pinHash`
 * todavía, o está bloqueado, para que esos caminos cuesten un tiempo
 * similar al de una verificación real y no delaten por temporización cuál
 * de los casos ocurrió.
 */
let dummyHashPromise: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);
  return dummyHashPromise;
}

export async function verifyAgainstDummy(pin: string): Promise<void> {
  const dummyHash = await getDummyHash();
  await argon2.verify(dummyHash, pin).catch(() => false);
}
