import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { config } from '../../config';
import { addDays, formatLocalDate, startOfLocalDay, toLocalDate } from '../../lib/businessTime';
import { prisma } from '../../lib/prisma';
import { getDashboard } from '../../dashboard/dashboardService';
import { defaultPerformanceRange, getPerformance } from '../../performance/performanceService';

/**
 * Regla definitiva de Desempeño contra PostgreSQL real (`demo`): el filtro por
 * relación de URGENT/ONE_TIME, las ejecuciones revertidas y el conteo de
 * sentencias. Fixtures `test-perf-<RUN>`, limpieza por IDs propios, sin tocar
 * filas reales (solo se leen como parte del resumen y no se aseveran).
 */
const RUN = `test-perf-${Date.now()}`;
const tz = config.businessTimeZone;
const today = toLocalDate(new Date(), tz);
// Rango público de 14 días (15 a 2 días atrás); la diaria de Juan cubre sus últimos 10.
const from = addDays(today, -15);
const to = addDays(today, -2);
const days = Array.from({ length: 10 }, (_, i) => addDays(from, i + 4));
const at = (day: ReturnType<typeof addDays>, hours = 15) =>
  new Date(startOfLocalDay(day, tz).getTime() + hours * 3_600_000);

const ids = { employees: [] as string[], tasks: [] as string[], users: [] as string[] };
let juan = '';
let coke = '';
let userId = '';

type QueryFn = (...args: unknown[]) => unknown;
const originalQuery = pg.Client.prototype.query as unknown as QueryFn;
let counting = false;
let statements = 0;

async function task(
  employeeId: string,
  frequency: 'DAILY' | 'URGENT' | 'ONE_TIME',
  name: string,
  validFrom: Date,
) {
  const row = await prisma.task.create({
    data: { description: `${RUN} ${name}`, employeeId, frequency },
    select: { id: true },
  });
  ids.tasks.push(row.id);
  await prisma.taskPlanningInterval.create({
    data: { taskId: row.id, employeeId, frequency, validFrom },
  });
  return row.id;
}

beforeAll(async () => {
  expect(process.env.DATABASE_TARGET).toBe('demo');
  for (const name of ['juan', 'coke']) {
    const e = await prisma.employee.create({
      data: {
        code: `${RUN}-${name}`,
        displayName: `Sintético ${name} ${RUN}`,
        role: 'Otro',
        colorHex: '#4a7c59',
      },
      select: { id: true },
    });
    ids.employees.push(e.id);
  }
  [juan, coke] = ids.employees as [string, string];
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-admin`,
      role: 'ADMIN',
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
    },
    select: { id: true },
  });
  ids.users.push(user.id);
  userId = user.id;

  const planStart = startOfLocalDay(addDays(from, -5), tz);
  const daily = await task(juan, 'DAILY', 'diaria de Juan', startOfLocalDay(days[0]!, tz));
  // Días 1–8 los hace Juan, el 9 lo cubre Coke, el 10 se completó y se revirtió (pendiente).
  for (const [i, day] of days.entries()) {
    const reverted = i === 9;
    await prisma.taskExecution.create({
      data: {
        taskId: daily,
        periodKey: formatLocalDate(day),
        completed: !reverted,
        completedAt: at(day),
        assignedEmployeeId: juan,
        completedByEmployeeId: i === 8 ? coke : juan,
        ...(reverted
          ? { revertedAt: at(day, 16), revertedByUserId: userId, revertReason: 'test' }
          : {}),
      },
    });
  }
  // Única de Juan completada ANTES del rango: no debe entrar aunque su planificación siga abierta.
  const oneTime = await task(
    juan,
    'ONE_TIME',
    'única de Juan previa',
    startOfLocalDay(addDays(from, -10), tz),
  );
  await prisma.taskExecution.create({
    data: {
      taskId: oneTime,
      periodKey: 'ONE_TIME',
      completed: true,
      completedAt: at(addDays(from, -3)),
      assignedEmployeeId: juan,
      completedByEmployeeId: juan,
    },
  });
  // Urgente de Coke hecha por Coke dentro del rango: una sola obligación.
  const urgent = await task(coke, 'URGENT', 'urgente de Coke', planStart);
  await prisma.taskExecution.create({
    data: {
      taskId: urgent,
      periodKey: 'URGENT',
      completed: true,
      completedAt: at(days[4]!),
      assignedEmployeeId: coke,
      completedByEmployeeId: coke,
    },
  });

  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    if (counting) statements += 1;
    return originalQuery.apply(this, args);
  };
}, 60_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  await prisma.taskExecution.deleteMany({ where: { taskId: { in: ids.tasks } } });
  await prisma.taskPlanningInterval.deleteMany({ where: { taskId: { in: ids.tasks } } });
  await prisma.task.deleteMany({ where: { id: { in: ids.tasks } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids.employees } } });
  expect(await prisma.task.count({ where: { description: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: RUN } } })).toBe(0);
}, 60_000);

const range = () => ({ from: formatLocalDate(from), to: formatLocalDate(to) });
const admin = () => ({ userId, role: 'ADMIN' as const, employeeId: null });

describe('Desempeño contra demo', () => {
  it('Juan 8/10 = 80% con 1 cobertura recibida; Coke 100% propio + 1 cobertura realizada', async () => {
    counting = true;
    statements = 0;
    const result = await getPerformance(admin(), range());
    counting = false;
    const summaryStatements = statements;
    const row = (id: string) => result.employees.find((e) => e.employee.id === id)!;
    expect(row(juan)).toMatchObject({
      assigned: 10,
      completedPersonally: 8,
      percentage: 80,
      pending: 1,
      coverageReceived: 1,
      coverageGiven: 0,
      operationalCompleted: 8,
    });
    expect(row(coke)).toMatchObject({
      assigned: 1,
      completedPersonally: 1,
      percentage: 100,
      pending: 0,
      coverageReceived: 0,
      coverageGiven: 1,
      operationalCompleted: 2,
    });
    // Resumen: sentencias fijas (4 en paralelo + la relación de descripción de la planificación).
    expect(summaryStatements).toBe(5);
  });

  it('detalle de EMPLOYEE propio: mismas cifras y sentencias constantes', async () => {
    counting = true;
    statements = 0;
    const result = await getPerformance({ userId, role: 'EMPLOYEE', employeeId: juan }, range());
    counting = false;
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0]).toMatchObject({ percentage: 80, coverageReceived: 1 });
    expect(result.occurrences!.filter((o) => o.status === 'covered')).toHaveLength(1);
    expect(statements).toBe(6);
  });

  it('Inicio muestra exactamente las cifras de Desempeño (SQL real, mismo rango y actor)', async () => {
    // "Ahora" al final del último día del rango: la ventana de 7 días de Inicio cae dentro de los fixtures.
    const now = new Date(startOfLocalDay(addDays(to, 1), tz).getTime() - 60_000);
    const range = defaultPerformanceRange(now);
    const pick = <T extends { employee: { id: string } }>(rows: T[], id: string) =>
      rows.find((row) => row.employee.id === id)!;
    const performance = await getPerformance(admin(), range, undefined, now);
    const dashboard = await getDashboard(admin(), now);
    for (const id of [juan, coke]) {
      const row = pick(performance.employees, id);
      expect(pick(dashboard.performance!.employees, id)).toEqual({
        employee: { id, displayName: row.employee.displayName, colorHex: row.employee.colorHex },
        assigned: row.assigned,
        completedPersonally: row.completedPersonally,
        percentage: row.percentage,
        pending: row.pending,
        coverageReceived: row.coverageReceived,
        coverageGiven: row.coverageGiven,
      });
    }
    const juanDashboard = await getDashboard({ userId, role: 'EMPLOYEE', employeeId: juan }, now);
    expect(juanDashboard.performance?.employees.map((row) => row.employee.id)).toEqual([juan]);
    expect(JSON.stringify(juanDashboard.performance)).not.toContain(coke);
    expect(juanDashboard.performance?.employees[0]).toMatchObject({
      percentage: pick(performance.employees, juan).percentage,
      coverageReceived: pick(performance.employees, juan).coverageReceived,
    });
  });
});
