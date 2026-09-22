import { describe, expect, it } from 'vitest';
import {
  animalTypeSeeds,
  employeeSeeds,
  eventSeeds,
  newsReportSeeds,
  OMITTED_BENJAMIN_BIRTHDAY,
  propertyLocationSeed,
  recurringBirthdaySeeds,
  stockCategorySeeds,
  stockItemSeeds,
  taskSeeds,
  userSeeds,
} from '../../prisma/seed-data';

/**
 * Valida el inventario de datos del seed como estructuras puras en memoria
 * — sin PrismaClient, sin adapter, sin PostgreSQL. Esto es posible porque
 * `prisma/seed-data/*.ts` no importa nada de `@prisma/client` en tiempo de
 * ejecución (solo tipos de enums generados, que no requieren conexión).
 */

describe('Conteo total del seed', () => {
  it('existen exactamente 61 entidades maestras/principales', () => {
    const masterCount =
      employeeSeeds.length + // 4
      userSeeds.length + // 4
      taskSeeds.length + // 10
      stockCategorySeeds.length + // 13
      stockItemSeeds.length + // 14
      newsReportSeeds.length + // 2
      eventSeeds.length + // 2
      recurringBirthdaySeeds.length + // 2
      animalTypeSeeds.length + // 9
      1; // propertyLocationSeed (una sola ubicación, no es un array)

    expect(masterCount).toBe(61);
  });

  it('cada StockItem genera exactamente 1 movimiento de apertura (14 en total) — no se cuentan como entidades maestras nuevas', () => {
    // Los movimientos de apertura no tienen su propio array de seed-data:
    // se crean 1:1 junto con cada StockItem (ver seed.ts, seedStockItems).
    // Este test documenta explícitamente esa relación 1:1 para que el
    // conteo de "14 movimientos" nunca se vuelva a sumar por error dentro
    // del total de entidades maestras.
    const openingMovementsCount = stockItemSeeds.length;
    expect(openingMovementsCount).toBe(14);
  });

  it('el total potencial de filas persistidas en una base vacía es 75 (61 maestras + 14 movimientos de apertura)', () => {
    const masterCount =
      employeeSeeds.length +
      userSeeds.length +
      taskSeeds.length +
      stockCategorySeeds.length +
      stockItemSeeds.length +
      newsReportSeeds.length +
      eventSeeds.length +
      recurringBirthdaySeeds.length +
      animalTypeSeeds.length +
      1;
    const openingMovementsCount = stockItemSeeds.length;

    expect(masterCount + openingMovementsCount).toBe(75);
  });
});

describe('Empleados', () => {
  it('existen exactamente 4 empleados iniciales', () => {
    expect(employeeSeeds).toHaveLength(4);
  });

  it('cada empleado tiene un code único, no vacío', () => {
    const codes = employeeSeeds.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach((code) => expect(code.length).toBeGreaterThan(0));
  });

  it('son exactamente Coke, Cami, Ruth y Pablo (index.html líneas 928-933)', () => {
    expect(employeeSeeds.map((e) => e.displayName).sort()).toEqual([
      'Cami',
      'Coke',
      'Pablo',
      'Ruth',
    ]);
  });
});

describe('Usuarios pendientes de activación', () => {
  it('existen exactamente 4 usuarios pendientes', () => {
    expect(userSeeds).toHaveLength(4);
  });

  it('cada usuario se vincula con un empleado real (employeeCode existente)', () => {
    const employeeCodes = new Set(employeeSeeds.map((e) => e.code));
    for (const user of userSeeds) {
      expect(employeeCodes.has(user.employeeCode)).toBe(true);
    }
  });

  it('los usernames son únicos', () => {
    const usernames = userSeeds.map((u) => u.username);
    expect(new Set(usernames).size).toBe(usernames.length);
  });

  it('los usernames están normalizados (minúsculas, sin espacios ni acentos)', () => {
    for (const user of userSeeds) {
      expect(user.username).toMatch(/^[a-z0-9._-]+$/);
    }
  });

  it('no hay credenciales, PIN ni hashes inventados en los datos del seed', () => {
    for (const user of userSeeds as unknown as Record<string, unknown>[]) {
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('password');
      expect(user).not.toHaveProperty('pin');
      expect(user).not.toHaveProperty('hash');
    }
  });

  it('no existe ningún usuario admin inventado (todos corresponden a empleados reales, rol EMPLOYEE en seed.ts)', () => {
    // userSeeds no lleva "role" — seed.ts fuerza SystemRole.EMPLOYEE para
    // todos; este test documenta esa garantía estructural. Ver también el
    // guard de código fuente en seed-source-guards.test.ts.
    expect(userSeeds.every((u) => 'username' in u && 'employeeCode' in u)).toBe(true);
  });
});

describe('Tareas', () => {
  it('existen exactamente 10 tareas', () => {
    expect(taskSeeds).toHaveLength(10);
  });

  it('todas las tareas tienen un empleado asignado válido', () => {
    const employeeCodes = new Set(employeeSeeds.map((e) => e.code));
    for (const task of taskSeeds) {
      expect(employeeCodes.has(task.employeeCode)).toBe(true);
    }
  });

  it('no hay tareas duplicadas (misma persona + misma descripción)', () => {
    const keys = taskSeeds.map((t) => `${t.employeeCode}::${t.description}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('coinciden exactamente con las 10 tareas reales de index.html (líneas 934-945)', () => {
    expect(taskSeeds.map((t) => t.description)).toEqual([
      'Limpiar baños',
      'Aspirar planta baja',
      'Cambiar ropa de cama',
      'Limpiar cocina a fondo',
      'Planchar ropa',
      'Limpiar ventanas exteriores',
      'Cortar el pasto — zona principal',
      'Regar jardines',
      'Revisar sistema de riego',
      'Fumigar perímetro',
    ]);
  });
});

describe('Categorías de stock', () => {
  it('existen exactamente las 13 categorías auditadas (6 casa + 7 jardín)', () => {
    expect(stockCategorySeeds).toHaveLength(13);
    expect(stockCategorySeeds.filter((c) => c.area === 'HOUSE')).toHaveLength(6);
    expect(stockCategorySeeds.filter((c) => c.area === 'GARDEN')).toHaveLength(7);
  });

  it('no hay categorías duplicadas (mismo nombre + área)', () => {
    const keys = stockCategorySeeds.map((c) => `${c.area}::${c.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Productos de stock', () => {
  it('existen exactamente 14 productos', () => {
    expect(stockItemSeeds).toHaveLength(14);
  });

  it('cada producto referencia una categoría y área existentes en stockCategorySeeds', () => {
    const validKeys = new Set(stockCategorySeeds.map((c) => `${c.area}::${c.name}`));
    for (const item of stockItemSeeds) {
      expect(validKeys.has(`${item.area}::${item.categoryName}`)).toBe(true);
    }
  });

  it('no hay productos duplicados (mismo nombre + área)', () => {
    const keys = stockItemSeeds.map((i) => `${i.area}::${i.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('las cantidades se representan como strings decimales seguros, no number/float', () => {
    for (const item of stockItemSeeds) {
      expect(typeof item.minimumQuantity).toBe('string');
      expect(typeof item.openingQuantity).toBe('string');
      expect(item.minimumQuantity).toMatch(/^\d+(\.\d+)?$/);
      expect(item.openingQuantity).toMatch(/^\d+(\.\d+)?$/);
    }
  });

  it('preserva exactamente cantidad inicial, mínimo y unidad del inventario auditado (index.html líneas 949-966)', () => {
    const expected: Record<
      string,
      { unit: string; minimumQuantity: string; openingQuantity: string }
    > = {
      'HOUSE::Detergente': { unit: 'litros', minimumQuantity: '3', openingQuantity: '2' },
      'HOUSE::Lavandina': { unit: 'litros', minimumQuantity: '3', openingQuantity: '5' },
      'HOUSE::Desinfectante pisos': { unit: 'litros', minimumQuantity: '2', openingQuantity: '1' },
      'HOUSE::Papel higiénico': { unit: 'rollos', minimumQuantity: '12', openingQuantity: '24' },
      'HOUSE::Bolsas de basura': { unit: 'unidades', minimumQuantity: '20', openingQuantity: '30' },
      'HOUSE::Trapos de piso': { unit: 'unidades', minimumQuantity: '4', openingQuantity: '3' },
      'HOUSE::Esponjas': { unit: 'unidades', minimumQuantity: '5', openingQuantity: '6' },
      'GARDEN::Fertilizante NPK': { unit: 'kg', minimumQuantity: '10', openingQuantity: '5' },
      'GARDEN::Herbicida glifosato': { unit: 'litros', minimumQuantity: '2', openingQuantity: '3' },
      'GARDEN::Insecticida': { unit: 'litros', minimumQuantity: '2', openingQuantity: '1' },
      'GARDEN::Combustible motosierra': {
        unit: 'litros',
        minimumQuantity: '5',
        openingQuantity: '8',
      },
      'GARDEN::Combustible cortadora': {
        unit: 'litros',
        minimumQuantity: '5',
        openingQuantity: '4',
      },
      'GARDEN::Mangueras de repuesto': {
        unit: 'metros',
        minimumQuantity: '1',
        openingQuantity: '2',
      },
      'GARDEN::Guantes de trabajo': { unit: 'pares', minimumQuantity: '2', openingQuantity: '1' },
    };

    expect(Object.keys(expected)).toHaveLength(14);
    for (const item of stockItemSeeds) {
      const key = `${item.area}::${item.name}`;
      const exp = expected[key];
      expect(exp, `producto inesperado: ${key}`).toBeDefined();
      expect(item.unit).toBe(exp!.unit);
      expect(item.minimumQuantity).toBe(exp!.minimumQuantity);
      expect(item.openingQuantity).toBe(exp!.openingQuantity);
    }
  });

  it('todos los movimientos de apertura son OPENING_BALANCE', () => {
    for (const item of stockItemSeeds) {
      expect(item.movementType).toBe('OPENING_BALANCE');
    }
  });
});

describe('Novedades', () => {
  it('existen exactamente 2 novedades reales', () => {
    expect(newsReportSeeds).toHaveLength(2);
  });

  it('cada novedad referencia un empleado real', () => {
    const employeeCodes = new Set(employeeSeeds.map((e) => e.code));
    for (const news of newsReportSeeds) {
      expect(employeeCodes.has(news.employeeCode)).toBe(true);
    }
  });

  it('no hay novedades duplicadas (misma persona + mismo texto — clave natural del seed)', () => {
    const keys = newsReportSeeds.map((n) => `${n.employeeCode}::${n.text}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Eventos históricos', () => {
  it('existen exactamente los 2 eventos reales confirmados (no el de Benjamín)', () => {
    expect(eventSeeds).toHaveLength(2);
    expect(eventSeeds.map((e) => e.title)).toEqual([
      'Revisión bomba de agua',
      'Visita familia O’Dwyer',
    ]);
  });

  it('ningún evento sembrado es un cumpleaños de Benjamín', () => {
    expect(eventSeeds.some((e) => e.title.includes('Benjamín'))).toBe(false);
  });

  it('no hay eventos duplicados (título + fecha + tipo — clave natural del seed)', () => {
    const keys = eventSeeds.map((e) => `${e.title}::${e.date}::${e.type}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Cumpleaños recurrentes', () => {
  it('existen exactamente 2 cumpleaños recurrentes (Vicky y Felicitas)', () => {
    expect(recurringBirthdaySeeds).toHaveLength(2);
    expect(recurringBirthdaySeeds.map((b) => b.personLabel).sort()).toEqual(['Felicitas', 'Vicky']);
  });

  it('Vicky y Felicitas solo guardan mes y día, no un año fijo', () => {
    for (const birthday of recurringBirthdaySeeds) {
      expect(typeof birthday.month).toBe('number');
      expect(typeof birthday.day).toBe('number');
      expect(birthday).not.toHaveProperty('year');
    }
  });

  it('Benjamín NO se siembra con ninguna fecha (contradicción sin resolver)', () => {
    expect(recurringBirthdaySeeds.some((b) => b.personLabel === 'Benjamín')).toBe(false);
    expect(OMITTED_BENJAMIN_BIRTHDAY.personLabel).toBe('Benjamín');
    expect(OMITTED_BENJAMIN_BIRTHDAY.contradictingDates.length).toBeGreaterThanOrEqual(2);
  });

  it('no hay slugs duplicados (clave natural del seed)', () => {
    const slugs = recurringBirthdaySeeds.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('Tipos de mascota', () => {
  it('existen exactamente los 9 tipos reales', () => {
    expect(animalTypeSeeds).toHaveLength(9);
    expect(animalTypeSeeds.map((t) => t.name)).toEqual([
      'Perro',
      'Gato',
      'Caballo',
      'Burro',
      'Guinea',
      'Pato',
      'Pavo real',
      'Gallina',
      'Faisán',
    ]);
  });

  it('no hay tipos de mascota duplicados', () => {
    const names = animalTypeSeeds.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('Ubicación de la propiedad', () => {
  it('coincide con las coordenadas reales del prototipo', () => {
    expect(propertyLocationSeed.label).toBe('Villa Elisa, Entre Ríos');
    expect(propertyLocationSeed.latitude).toBe('-32.15');
    expect(propertyLocationSeed.longitude).toBe('-58.40');
  });
});
