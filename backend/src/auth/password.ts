import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

/**
 * Política de contraseñas — NIST SP 800-63B desaconseja reglas de
 * composición arbitrarias (mayúsculas/símbolos obligatorios); en cambio,
 * exige un mínimo de longitud razonable y permite frases largas. Sin
 * máximo tan bajo que impida una passphrase, pero con un techo para no
 * hashear entradas absurdamente grandes (mitiga abuso/DoS antes de llegar
 * a Argon2, que ya de por sí es costoso a propósito).
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordValidationResult = { ok: true } | { ok: false; reason: string };

/** Pura — no toca argon2 ni la base, para poder testearla sin dependencias. */
export function validatePasswordPolicy(password: string): PasswordValidationResult {
  if (typeof password !== 'string') {
    return { ok: false, reason: 'La contraseña debe ser una cadena de texto.' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      reason: `La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres.`,
    };
  }
  // Caracteres de control (no imprimibles) rechazados; todo lo demás —
  // espacios, acentos, símbolos, emoji — se acepta a propósito, para no
  // impedir passphrases largas y naturales.
  // eslint-disable-next-line no-control-regex -- exactamente lo que se busca: caracteres de control
  if (/[\x00-\x1f\x7f]/.test(password)) {
    return { ok: false, reason: 'La contraseña no puede contener caracteres de control.' };
  }
  return { ok: true };
}

/**
 * Parámetros Argon2id recomendados por OWASP (Password Storage Cheat
 * Sheet, primera opción): m=19456 KiB (~19 MiB), t=2, p=1. Un solo lugar
 * para estos valores — si se ajustan alguna vez, hashes viejos se siguen
 * verificando igual (Argon2 codifica sus propios parámetros en el hash).
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Lanza si la contraseña no cumple la política — nunca hashea una contraseña inválida. */
export async function hashPassword(password: string): Promise<string> {
  const validation = validatePasswordPolicy(password);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }
  return argon2.hash(password, ARGON2_OPTIONS);
}

/** Comparación segura vía argon2.verify (constant-time internamente). Nunca lanza — un hash corrupto es simplemente "no coincide". */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Hash dummy — calculado una sola vez, en el primer uso, a partir de bytes
 * aleatorios (nunca de una contraseña real ni de un valor fijo). Se
 * verifica contra él cuando el usuario no existe o no tiene `passwordHash`
 * todavía, para que ese camino cueste tiempo similar al de una
 * verificación real y no delate por temporización que la cuenta no existe.
 */
let dummyHashPromise: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);
  return dummyHashPromise;
}

export async function verifyAgainstDummy(password: string): Promise<void> {
  const dummyHash = await getDummyHash();
  await argon2.verify(dummyHash, password).catch(() => false);
}
