import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = '../../prisma/migrations/20260930120000_activity_participant_user/migration.sql';

const sql = readFileSync(resolve(__dirname, MIGRATION), 'utf-8');
const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8');

describe('migración 20260930120000_activity_participant_user (administradores como participantes)', () => {
  it('no borra ni reescribe datos y no usa CASCADE', () => {
    expect(sql).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|ON DELETE CASCADE|SET NOT NULL/i,
    );
    expect(sql).not.toMatch(/postgres(?:ql)?:\/\/|neon\.tech|password/i);
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('solo agrega dos columnas nullable, dos índices, dos FK RESTRICT y dos CHECK de exclusión', () => {
    for (const table of ['stock_movements', 'egg_collections']) {
      expect(sql).toContain(`ALTER TABLE "${table}" ADD COLUMN     "participant_user_id" UUID;`);
      expect(sql).toContain(
        `CREATE INDEX "${table}_participant_user_id_idx" ON "${table}"("participant_user_id");`,
      );
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_participant_user_id_fkey" FOREIGN KEY \\("participant_user_id"\\) REFERENCES "users"\\("id"\\) ON DELETE RESTRICT`,
        ),
      );
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_single_participant_check" CHECK ("employee_id" IS NULL OR "participant_user_id" IS NULL);`,
      );
    }
    expect([...sql.matchAll(/ADD COLUMN/g)]).toHaveLength(2);
    expect([...sql.matchAll(/ADD CONSTRAINT/g)]).toHaveLength(4);
    expect([...sql.matchAll(/CREATE (UNIQUE )?INDEX/g)]).toHaveLength(2);
  });

  it('el schema declara las relaciones con el participante ADMIN', () => {
    expect(schema).toMatch(/@relation\("StockMovementParticipantUser"/);
    expect(schema).toMatch(/@relation\("EggCollectionParticipantUser"/);
    expect([
      ...schema.matchAll(/participantUserId String\? @map\("participant_user_id"\) @db\.Uuid/g),
    ]).toHaveLength(2);
  });
});
