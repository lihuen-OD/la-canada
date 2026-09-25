import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20260924210000_stock_idempotency_balance_check/migration.sql',
  ),
  'utf-8',
);
const SCHEMA = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

function modelBlock(modelName: string): string {
  const match = SCHEMA.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`No se encontró el modelo ${modelName}`);
  return match[1] ?? '';
}

describe('migración stock_idempotency_balance_check (Etapa 5C.1A)', () => {
  it('crea una sola tabla y ninguna instrucción destructiva o cascada', () => {
    expect(MIGRATION.match(/^CREATE TABLE /gm)).toHaveLength(1);
    expect(MIGRATION).toContain('CREATE TABLE "idempotency_records"');
    expect(MIGRATION).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|ON DELETE CASCADE/i,
    );
  });

  it('actor obligatorio, PK UUID, respuesta temporalmente nullable y timestamps compatibles con Prisma', () => {
    expect(MIGRATION).toMatch(/"id" UUID NOT NULL/);
    expect(MIGRATION).toMatch(/"actor_user_id" UUID NOT NULL/);
    expect(MIGRATION).toMatch(/"response_status" INTEGER,/);
    expect(MIGRATION).toMatch(/"response_body" JSONB,/);
    expect(MIGRATION).toMatch(/"completed_at" TIMESTAMP\(3\),/);
    expect(MIGRATION).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(MIGRATION).toMatch(/CONSTRAINT "idempotency_records_pkey" PRIMARY KEY \("id"\)/);
  });

  it('declara unique actor+endpoint+key e índice created_at exactos', () => {
    expect(MIGRATION).toMatch(
      /CREATE UNIQUE INDEX "idempotency_records_actor_user_id_endpoint_key_key" ON "idempotency_records"\("actor_user_id", "endpoint", "key"\)/,
    );
    expect(MIGRATION).toMatch(
      /CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"\("created_at"\)/,
    );
  });

  it('la FK obligatoria apunta a users y usa RESTRICT, nunca SET NULL/CASCADE', () => {
    expect(MIGRATION).toMatch(
      /FOREIGN KEY \("actor_user_id"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(MIGRATION).not.toMatch(/actor_user_id[\s\S]*ON DELETE SET NULL/i);
  });

  it('agrega exactamente el CHECK de saldo no negativo aprobado', () => {
    expect(MIGRATION).toMatch(
      /ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_current_quantity_non_negative_check" CHECK \("current_quantity" >= 0\)/,
    );
    expect(MIGRATION.match(/\bCHECK\s*\(/g)).toHaveLength(1);
  });

  it('contiene exactamente las 5 sentencias aprobadas y nada más', () => {
    const statements = MIGRATION.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    expect(statements).toHaveLength(5);
    expect(statements.map((statement) => statement.split(' (')[0]?.split(' ON ')[0])).toEqual([
      'CREATE TABLE "idempotency_records"',
      'CREATE INDEX "idempotency_records_created_at_idx"',
      'CREATE UNIQUE INDEX "idempotency_records_actor_user_id_endpoint_key_key"',
      'ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_fkey" FOREIGN KEY',
      'ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_current_quantity_non_negative_check" CHECK',
    ]);
  });

  it('no toca stock_movements.reference, datos existentes ni contiene URLs o credenciales', () => {
    expect(MIGRATION).not.toMatch(/stock_movements/);
    expect(MIGRATION).not.toMatch(/\bINSERT\b|\bUPDATE\s+"|\bALTER\s+COLUMN\b|\bRENAME\b/i);
    expect(MIGRATION).not.toMatch(/:\/\/|password|secret|token|neon\.tech/i);
  });

  it('SQL y schema coinciden en campos, relación e índices del modelo', () => {
    const block = modelBlock('IdempotencyRecord');
    const userBlock = modelBlock('User');
    expect(block).toMatch(/actorUserId\s+String\s+@map\("actor_user_id"\)\s+@db\.Uuid/);
    expect(block).toMatch(
      /actor\s+User\s+@relation\(fields: \[actorUserId\], references: \[id\]\)/,
    );
    expect(block).toMatch(/responseStatus\s+Int\?/);
    expect(block).toMatch(/responseBody\s+Json\?/);
    expect(block).toMatch(/completedAt\s+DateTime\?/);
    expect(block).toMatch(/@@unique\(\[actorUserId, endpoint, key\]\)/);
    expect(block).toMatch(/@@index\(\[createdAt\]\)/);
    expect(block).toMatch(/@@map\("idempotency_records"\)/);
    expect(userBlock).toMatch(/idempotencyRecords\s+IdempotencyRecord\[\]/);
  });
});
