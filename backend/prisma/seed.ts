/**
 * Seed idempotente de datos iniciales reales — Etapa 2.
 *
 * NO se ejecuta en esta etapa (ver AGENTS.md regla 3 y los límites de la
 * Etapa 2). Este archivo se escribe, se tipa y se revisa, pero no corre
 * contra ninguna base todavía: no hay conexión a Neon.
 *
 * Principios (ver docs/MIGRATION_PLAN.md, "Identificadores estables del
 * seed" y "Seed de datos reales"):
 *  - Se puede correr más de una vez sin duplicar nada: cada entidad se
 *    busca por una clave natural estable antes de crearla
 *    (`createIfMissing`, ver seed-lib/).
 *  - Si ya existe, NO se pisa (nunca se llama `.update()` acá) — así no se
 *    revierte silenciosamente un cambio que un administrador haya hecho
 *    después de la carga inicial.
 *  - Nunca usa `deleteMany`, nunca resetea nada.
 *  - Los IDs (UUID) los genera Prisma en el momento de la creación — nunca
 *    se hardcodea un UUID fijo acá; la idempotencia no depende del ID sino
 *    de la clave natural de cada `createIfMissing`.
 *  - Los movimientos de inventario (alta de producto + saldo inicial) se
 *    crean dentro de una transacción: o se confirman ambos, o no queda
 *    ninguno.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { Prisma } from '../src/generated/prisma/client';
import { SystemRole } from '../src/generated/prisma/enums';
import {
  animalTypeSeeds,
  employeeSeeds,
  eventSeeds,
  newsReportSeeds,
  propertyLocationSeed,
  recurringBirthdaySeeds,
  stockCategorySeeds,
  stockItemSeeds,
  taskSeeds,
  userSeeds,
} from './seed-data';
import { createIfMissing, SeedContradictionError } from './seed-lib/createIfMissing';

type Tx = Prisma.TransactionClient;

async function seedEmployees(db: Tx) {
  const byCode = new Map<string, { id: string }>();
  for (const seed of employeeSeeds) {
    const { record, created } = await createIfMissing(
      () =>
        db.employee.findUnique({
          where: { code: seed.code },
          select: { id: true, displayName: true },
        }),
      () =>
        db.employee.create({
          data: {
            code: seed.code,
            displayName: seed.displayName,
            role: seed.role,
            colorHex: seed.colorHex,
          },
          select: { id: true, displayName: true },
        }),
    );
    if (!created && record.displayName !== seed.displayName) {
      throw new SeedContradictionError(
        `Employee.code="${seed.code}" ya existe con displayName="${record.displayName}", ` +
          `distinto del esperado "${seed.displayName}". Puede ser una colisión de código, no revisar a ciegas.`,
      );
    }
    byCode.set(seed.code, record);
  }
  return byCode;
}

async function seedUsers(db: Tx, employeesByCode: Map<string, { id: string }>) {
  for (const seed of userSeeds) {
    const employee = employeesByCode.get(seed.employeeCode);
    if (!employee) {
      throw new SeedContradictionError(
        `userSeeds referencia employeeCode="${seed.employeeCode}" que no existe en employeeSeeds.`,
      );
    }
    const { record, created } = await createIfMissing(
      () =>
        db.user.findUnique({
          where: { username: seed.username },
          select: { id: true, employeeId: true },
        }),
      () =>
        db.user.create({
          data: {
            username: seed.username,
            role: SystemRole.EMPLOYEE,
            // status y pinHash usan el default del schema:
            // PENDING_ACTIVATION / null — ver modelo User.
            employeeId: employee.id,
          },
          select: { id: true, employeeId: true },
        }),
    );
    if (!created && record.employeeId !== employee.id) {
      throw new SeedContradictionError(
        `User.username="${seed.username}" ya existe vinculado a otro empleado (employeeId="${record.employeeId}"), ` +
          `no a "${seed.employeeCode}" (id="${employee.id}"). Identidad contradictoria, no se continúa.`,
      );
    }
  }
}

async function seedTasks(db: Tx, employeesByCode: Map<string, { id: string }>) {
  for (const seed of taskSeeds) {
    const employee = employeesByCode.get(seed.employeeCode);
    if (!employee) {
      throw new SeedContradictionError(
        `taskSeeds referencia employeeCode="${seed.employeeCode}" que no existe en employeeSeeds.`,
      );
    }
    await createIfMissing(
      () =>
        db.task.findUnique({
          where: {
            employeeId_description: { employeeId: employee.id, description: seed.description },
          },
          select: { id: true },
        }),
      () =>
        db.task.create({
          data: {
            employeeId: employee.id,
            description: seed.description,
            frequency: seed.frequency,
          },
          select: { id: true },
        }),
    );
  }
}

async function seedStockCategories(db: Tx) {
  const byKey = new Map<string, { id: string }>();
  for (const seed of stockCategorySeeds) {
    const key = `${seed.area}::${seed.name}`;
    const { record } = await createIfMissing(
      () =>
        db.stockCategory.findUnique({
          where: { name_area: { name: seed.name, area: seed.area } },
          select: { id: true },
        }),
      () =>
        db.stockCategory.create({
          data: { name: seed.name, area: seed.area },
          select: { id: true },
        }),
    );
    byKey.set(key, record);
  }
  return byKey;
}

async function seedStockItems(db: Tx, categoriesByKey: Map<string, { id: string }>) {
  for (const seed of stockItemSeeds) {
    const categoryKey = `${seed.area}::${seed.categoryName}`;
    const category = categoriesByKey.get(categoryKey);
    if (!category) {
      throw new SeedContradictionError(
        `stockItemSeeds "${seed.name}" referencia la categoría "${seed.categoryName}" (área ${seed.area}) ` +
          'que no existe en stockCategorySeeds.',
      );
    }

    const existing = await db.stockItem.findUnique({
      where: { area_name: { area: seed.area, name: seed.name } },
      select: { id: true },
    });
    if (existing) {
      // Ya existe (y por lo tanto ya tuvo su movimiento de apertura en un
      // run anterior, o fue dado de alta a mano) — no se toca ni el ítem
      // ni sus movimientos.
      continue;
    }

    // Alta de producto + saldo inicial: se confirman ambos juntos o ninguno.
    // `reference` es la clave natural que garantiza, con un @unique real de
    // Prisma/Postgres, que nunca pueda existir más de un movimiento de
    // apertura para este producto — no depende solo de `reason` (texto
    // descriptivo, frágil). Se deriva de la clave natural del propio ítem
    // (área+nombre), no de su UUID (que todavía no existe en este punto de
    // la escritura anidada).
    await db.stockItem.create({
      data: {
        name: seed.name,
        area: seed.area,
        categoryId: category.id,
        unit: seed.unit,
        minimumQuantity: seed.minimumQuantity,
        currentQuantity: seed.openingQuantity,
        movements: {
          create: {
            type: seed.movementType,
            quantity: seed.openingQuantity,
            effectiveDate: new Date(),
            // Sin employeeId ni destinationId: no hay evidencia de quién
            // cargó el saldo inicial en el prototipo — no se inventa.
            reason: 'Saldo inicial migrado desde el inventario auditado de index.html (Etapa 2).',
            reference: `${seed.area}::${seed.name}::${seed.movementType}`,
          },
        },
      },
      select: { id: true },
    });
  }
}

async function seedNewsReports(db: Tx, employeesByCode: Map<string, { id: string }>) {
  for (const seed of newsReportSeeds) {
    const employee = employeesByCode.get(seed.employeeCode);
    if (!employee) {
      throw new SeedContradictionError(
        `newsReportSeeds referencia employeeCode="${seed.employeeCode}" que no existe en employeeSeeds.`,
      );
    }
    await createIfMissing(
      () =>
        db.newsReport.findFirst({
          where: { employeeId: employee.id, text: seed.text },
          select: { id: true },
        }),
      () =>
        db.newsReport.create({
          data: { employeeId: employee.id, text: seed.text },
          select: { id: true },
        }),
    );
  }
}

async function seedEvents(db: Tx) {
  for (const seed of eventSeeds) {
    const date = new Date(`${seed.date}T00:00:00.000Z`);
    await createIfMissing(
      () =>
        db.event.findFirst({
          where: { title: seed.title, date, type: seed.type, deletedAt: null },
          select: { id: true },
        }),
      () =>
        db.event.create({
          data: { title: seed.title, date, type: seed.type, note: seed.note },
          select: { id: true },
        }),
    );
  }
}

async function seedRecurringBirthdays(db: Tx) {
  for (const seed of recurringBirthdaySeeds) {
    await createIfMissing(
      () => db.recurringBirthday.findUnique({ where: { slug: seed.slug }, select: { id: true } }),
      () =>
        db.recurringBirthday.create({
          data: {
            slug: seed.slug,
            personLabel: seed.personLabel,
            month: seed.month,
            day: seed.day,
            relationship: seed.relationship,
          },
          select: { id: true },
        }),
    );
  }
}

async function seedAnimalTypes(db: Tx) {
  for (const seed of animalTypeSeeds) {
    await createIfMissing(
      () => db.animalType.findUnique({ where: { name: seed.name }, select: { id: true } }),
      () =>
        db.animalType.create({ data: { name: seed.name, icon: seed.icon }, select: { id: true } }),
    );
  }
}

async function seedPropertyLocation(db: Tx) {
  // Búsqueda por `code` (clave natural del singleton), no por `label`
  // (nombre legible, que en teoría podría cambiar sin que cambie "cuál"
  // propiedad es).
  await createIfMissing(
    () =>
      db.propertyLocation.findUnique({
        where: { code: propertyLocationSeed.code },
        select: { id: true },
      }),
    () =>
      db.propertyLocation.create({
        data: {
          code: propertyLocationSeed.code,
          label: propertyLocationSeed.label,
          latitude: propertyLocationSeed.latitude,
          longitude: propertyLocationSeed.longitude,
        },
        select: { id: true },
      }),
  );
}

async function run(prisma: PrismaClient) {
  await prisma.$transaction(
    async (db) => {
      const employeesByCode = await seedEmployees(db);
      await seedUsers(db, employeesByCode);
      await seedTasks(db, employeesByCode);

      const categoriesByKey = await seedStockCategories(db);
      await seedStockItems(db, categoriesByKey);

      await seedNewsReports(db, employeesByCode);
      await seedEvents(db);
      await seedRecurringBirthdays(db);
      await seedAnimalTypes(db);
      await seedPropertyLocation(db);
    },
    // El timeout por defecto (5000 ms) alcanza contra una base local, pero no
    // contra Neon real: cada `createIfMissing` es un round-trip de red
    // secuencial, y 75 filas potenciales fácilmente superan 5 s de latencia
    // acumulada. Se sube a un valor generoso para esta etapa (seed manual,
    // no un endpoint con SLA) — no cambia la semántica "todo o nada".
    { timeout: 60_000, maxWait: 10_000 },
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL no está definida — el seed no se conecta ni corre sin ella (no aplica en la Etapa 2).',
    );
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  try {
    await run(prisma);
    // eslint-disable-next-line no-console -- resumen de ejecución del seed, intencional
    console.log('Seed completado.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Seed falló:', error);
    process.exitCode = 1;
  });
}
