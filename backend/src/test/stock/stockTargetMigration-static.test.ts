import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = '../../../prisma/migrations/20260930150000_stock_target_quantity/migration.sql';

const sql = readFileSync(resolve(__dirname, MIGRATION), 'utf-8');
const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf-8');

describe('migración 20260930150000_stock_target_quantity (stock objetivo)', () => {
  it('no borra ni reescribe datos: no inventa objetivos para los productos existentes', () => {
    expect(sql).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX|TYPE)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO|SET NOT NULL|DEFAULT/i,
    );
    expect(sql).not.toMatch(/postgres(?:ql)?:\/\/|neon\.tech|password/i);
  });

  it('solo agrega una columna NULLABLE con la precisión del mínimo y un CHECK', () => {
    expect(sql).toContain(
      'ALTER TABLE "stock_items" ADD COLUMN     "target_quantity" DECIMAL(10,2);',
    );
    expect([...sql.matchAll(/ADD COLUMN/g)]).toHaveLength(1);
    expect([...sql.matchAll(/ADD CONSTRAINT/g)]).toHaveLength(1);
    expect(sql).toContain(
      'CHECK ("target_quantity" IS NULL OR ("target_quantity" >= 0 AND "target_quantity" > "minimum_quantity"))',
    );
  });

  it('el schema declara el objetivo opcional con la misma precisión', () => {
    expect(schema).toMatch(
      /targetQuantity\s+Decimal\?\s+@map\("target_quantity"\) @db\.Decimal\(10, 2\)/,
    );
  });
});
