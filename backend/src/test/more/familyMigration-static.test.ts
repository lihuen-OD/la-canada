import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20260928120000_personal_profile_family/migration.sql',
  ),
  'utf-8',
);
const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');
const statements = sql.replace(/--.*$/gm, '');

describe('migración 20260928120000_personal_profile_family (Etapa 5F)', () => {
  it('solo estructura: sin DROP de tablas/columnas, sin borrar ni escribir filas, sin CASCADE destructivo', () => {
    expect(statements).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|TYPE)|TRUNCATE|DELETE\s+FROM/i);
    expect(statements).not.toMatch(/\b(INSERT|UPDATE)\s+(INTO\s+)?"?\w+"?\s+(SET|VALUES|\()/i);
    expect(statements).not.toMatch(/ON DELETE (CASCADE|SET NULL)/);
    expect([...statements.matchAll(/ON DELETE RESTRICT/g)]).toHaveLength(2);
  });

  it('no contiene datos concretos: ni personas, ni usernames, ni UUID, ni URLs', () => {
    expect(statements).not.toMatch(/vicky|felicitas|benjam|admin|username/i);
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(sql).not.toMatch(/https?:\/\/|postgres(ql)?:\/\//i);
  });

  it('crea el enum de relación (sin SELF), el perfil personal 1:1 y las columnas del familiar', () => {
    expect(statements).toMatch(
      /CREATE TYPE "FamilyRelation" AS ENUM \('PARTNER', 'CHILD', 'FAMILY', 'OTHER'\)/,
    );
    expect(statements).not.toMatch(/SELF/);
    expect(statements).toMatch(/CREATE TABLE "user_profiles"/);
    expect(statements).toMatch(/CREATE UNIQUE INDEX "user_profiles_user_id_key"/);
    expect(statements).toMatch(/ADD COLUMN\s+"birth_year" INTEGER/);
    expect(statements).toMatch(/ADD COLUMN\s+"owner_user_id" UUID/);
    expect(statements).toMatch(/ADD COLUMN\s+"relation" "FamilyRelation"/);
    expect(statements).toMatch(/ALTER COLUMN "slug" DROP NOT NULL/);
    expect(statements).toMatch(/recurring_birthdays_owner_user_id_created_at_idx/);
  });

  it('CHECKs: propietario ⇔ relación, día/mes reales, año real opcional y 29/02 solo bisiesto', () => {
    expect(statements).toMatch(/recurring_birthdays_owner_relation_check/);
    expect(statements).toMatch(/CHECK \(\("owner_user_id" IS NULL\) = \("relation" IS NULL\)\)/);
    expect(statements).toMatch(/recurring_birthdays_month_day_check/);
    expect(statements).toMatch(/recurring_birthdays_birth_year_check/);
    expect(statements).toMatch(/"birth_year" BETWEEN 1900 AND 2100/);
  });

  it('el schema declara las relaciones con onDelete: Restrict y sin Employee para el ADMIN', () => {
    expect(schema).toMatch(/model UserProfile \{/);
    expect(schema).toMatch(
      /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(schema).toMatch(/@relation\("RecurringBirthdayOwner".*onDelete: Restrict\)/);
    expect(schema).not.toMatch(/onDelete: Cascade/);
  });
});
