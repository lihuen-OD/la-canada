/**
 * Fake de Prisma en memoria — implementa exactamente los métodos que usan
 * `authService.ts`/`adminUsersController.ts`/`bootstrapAdmin.ts`, nada más.
 * `authService`/`bootstrapAdmin` reciben `prisma` como parámetro explícito
 * (inyección de dependencia ya presente en el diseño), así que este fake se
 * pasa directo — sin `vi.mock`, sin Neon, sin transacciones reales
 * (`$transaction` acá solo invoca el callback con el mismo fake; no hay
 * rollback real, no hace falta para testear la lógica de negocio).
 */

export interface FakeUserRecord {
  id: string;
  username: string;
  role: 'ADMIN' | 'EMPLOYEE';
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  pinHash: string | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  employee: { id: string; displayName: string; colorHex: string } | null;
  createdAt?: Date;
}

export interface FakeSessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface FakeAuditLogRecord {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousState: unknown;
  newState: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- fake deliberadamente laxo, solo para tests */

export function createFakePrisma(initialUsers: FakeUserRecord[] = []) {
  const users = new Map<string, FakeUserRecord>(initialUsers.map((u) => [u.id, { ...u }]));
  const sessions = new Map<string, FakeSessionRecord>();
  const auditLogs: FakeAuditLogRecord[] = [];
  // UUIDs reales (no "fake-1", "fake-2") — estos ids terminan en claims `sub`/`sid`
  // de JWTs reales (`signAccessToken`), y `verifyAccessToken` valida su forma
  // con `z.string().uuid()` (RFC 4122 estricto: nibble de versión y de
  // variante correctos) — igual que Prisma genera de verdad en `demo`.
  const nextId = (): string => crypto.randomUUID();

  const api: any = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id !== undefined) return users.get(where.id) ?? null;
        if (where.username !== undefined) {
          return [...users.values()].find((u) => u.username === where.username) ?? null;
        }
        return null;
      },
      findFirst: async ({ where = {} }: any = {}) => {
        return (
          [...users.values()].find(
            (u) =>
              (where.role === undefined || u.role === where.role) &&
              (where.status === undefined || u.status === where.status),
          ) ?? null
        );
      },
      count: async ({ where = {} }: any = {}) => {
        return [...users.values()].filter(
          (u) =>
            (where.role === undefined || u.role === where.role) &&
            (where.status === undefined || u.status === where.status) &&
            (!where.id?.not || u.id !== where.id.not),
        ).length;
      },
      findMany: async ({ where = {}, orderBy }: any = {}) => {
        let results = [...users.values()].filter(
          (u) => where.status === undefined || u.status === where.status,
        );
        if (orderBy?.createdAt === 'asc') {
          results = [...results].sort(
            (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
          );
        }
        return results;
      },
      create: async ({ data }: any) => {
        // Respeta un `id` explícito en `data` (como haría Prisma de verdad)
        // en vez de generar uno y guardarlo bajo una key distinta.
        const record: FakeUserRecord = {
          employee: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          createdAt: new Date(),
          ...data,
          id: data.id ?? nextId(),
        };
        users.set(record.id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const existing = users.get(where.id);
        if (!existing) throw new Error('fakePrisma: user not found');
        // Soporta el operador `{ increment: N }` de Prisma sobre campos
        // numéricos (usado por `authService.login` para el contador de
        // intentos fallidos) — el resto de los campos se asigna directo.
        const resolved: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
          if (value !== null && typeof value === 'object' && 'increment' in value) {
            const current = (existing as unknown as Record<string, unknown>)[key];
            resolved[key] =
              (typeof current === 'number' ? current : 0) +
              (value as { increment: number }).increment;
          } else {
            resolved[key] = value;
          }
        }
        const updated = { ...existing, ...resolved };
        users.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }: any) => {
        // Solo soporta la forma que usa `authService.login` para la toma
        // atómica del bloqueo: `id` + `OR: [{ lockedUntil: null }, { lockedUntil: { lt } }]`.
        let count = 0;
        for (const [id, u] of users) {
          if (where.id !== undefined && u.id !== where.id) continue;
          const matchesOr =
            where.OR === undefined ||
            (where.OR as any[]).some((cond) => {
              if (Object.hasOwn(cond, 'lockedUntil')) {
                if (cond.lockedUntil === null) return u.lockedUntil === null;
                if (cond.lockedUntil?.lt !== undefined) {
                  return (
                    u.lockedUntil !== null &&
                    u.lockedUntil.getTime() < cond.lockedUntil.lt.getTime()
                  );
                }
              }
              return false;
            });
          if (matchesOr) {
            users.set(id, { ...u, ...data });
            count += 1;
          }
        }
        return { count };
      },
    },
    session: {
      create: async ({ data }: any) => {
        const record: FakeSessionRecord = {
          revokedAt: null,
          createdAt: new Date(),
          ...data,
          id: data.id ?? nextId(),
        };
        sessions.set(record.id, record);
        return record;
      },
      findUnique: async ({ where }: any) => {
        if (where.id !== undefined) return sessions.get(where.id) ?? null;
        if (where.refreshTokenHash !== undefined) {
          return (
            [...sessions.values()].find((s) => s.refreshTokenHash === where.refreshTokenHash) ??
            null
          );
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const existing = sessions.get(where.id);
        if (!existing) throw new Error('fakePrisma: session not found');
        const updated = { ...existing, ...data };
        sessions.set(where.id, updated);
        return updated;
      },
      updateMany: async ({ where, data }: any) => {
        // Genérico a propósito: `authService.refresh()` usa este `updateMany`
        // de dos formas distintas — filtrando por `userId` (revocación
        // masiva ante reuso/carrera) y filtrando por `id` + `revokedAt: null`
        // + `expiresAt: { gt }` (la toma atómica de la sesión al rotar). Cada
        // condición de `where` presente debe cumplirse; una ausente no
        // descarta nada.
        let count = 0;
        for (const [id, session] of sessions) {
          const matchesId = where.id === undefined || session.id === where.id;
          const matchesUser = where.userId === undefined || session.userId === where.userId;
          const matchesRevoked =
            where.revokedAt === undefined
              ? true
              : where.revokedAt === null
                ? session.revokedAt === null
                : session.revokedAt === where.revokedAt;
          const matchesExpiresGt =
            where.expiresAt?.gt === undefined
              ? true
              : session.expiresAt.getTime() > where.expiresAt.gt.getTime();
          if (matchesId && matchesUser && matchesRevoked && matchesExpiresGt) {
            sessions.set(id, { ...session, ...data });
            count += 1;
          }
        }
        return { count };
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const record: FakeAuditLogRecord = { id: nextId(), createdAt: new Date(), ...data };
        auditLogs.push(record);
        return record;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(api),
  };

  return { prisma: api, users, sessions, auditLogs };
}
