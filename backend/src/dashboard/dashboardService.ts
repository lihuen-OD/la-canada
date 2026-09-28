import { config } from '../config';
import { prisma } from '../lib/prisma';
import { formatLocalDate, toLocalDate } from '../lib/businessTime';
import { computeStockLevel } from '../stock/stockLevel';
import { listTasks, type TaskActor } from '../tasks/tasksService';
import { listUpcomingEvents } from '../more/eventsService';
import { defaultPerformanceRange, getPerformance } from '../performance/performanceService';

const stockSelect = {
  id: true,
  name: true,
  area: true,
  unit: true,
  minimumQuantity: true,
  currentQuantity: true,
} as const;

const newsSelect = {
  id: true,
  text: true,
  createdAt: true,
  employee: { select: { id: true, displayName: true, colorHex: true } },
} as const;

/**
 * Desempeño de Inicio = EXACTAMENTE `getPerformance` (misma función, mismo
 * actor, rango predeterminado de Tareas → Desempeño): no hay una segunda
 * fórmula. ADMIN recibe a todo el equipo; EMPLOYEE solo sus propias cifras
 * (el alcance lo impone `getPerformance`). Solo se exponen las métricas de
 * cumplimiento personal y coberturas — ni detalle ni trabajo operativo.
 */
async function dashboardPerformance(actor: TaskActor, now: Date) {
  if (actor.role === 'EMPLOYEE' && !actor.employeeId) return null;
  const range = defaultPerformanceRange(now);
  const result = await getPerformance(actor, range, undefined, now);
  return {
    scope: actor.role === 'ADMIN' ? ('team' as const) : ('self' as const),
    range: { from: result.range.from, to: result.range.to, timeZone: result.range.timeZone },
    employees: result.employees.map((row) => ({
      employee: {
        id: row.employee.id,
        displayName: row.employee.displayName,
        colorHex: row.employee.colorHex,
      },
      assigned: row.assigned,
      completedPersonally: row.completedPersonally,
      percentage: row.percentage,
      pending: row.pending,
      coverageReceived: row.coverageReceived,
      coverageGiven: row.coverageGiven,
    })),
  };
}

/**
 * Inicio replica `rndInicio` del prototipo. Las ramas son independientes y se
 * resuelven en paralelo; la cantidad de sentencias es fija y no depende de
 * tarjetas, personas ni filas devueltas.
 */
export async function getDashboard(actor: TaskActor, now = new Date()) {
  const today = toLocalDate(now, config.businessTimeZone);
  const todayText = formatLocalDate(today);
  const todayDb = new Date(Date.UTC(today.year, today.month - 1, today.day));

  const [taskResult, performance, stockRows, eggAggregate, events, newsRows] = await Promise.all([
    listTasks(actor, { status: 'active' }, now),
    dashboardPerformance(actor, now),
    prisma.stockItem.findMany({
      where: { active: true },
      select: stockSelect,
      orderBy: [{ area: 'asc' }, { name: 'asc' }],
    }),
    prisma.eggCollection.aggregate({
      where: { collectionDate: todayDb, voidedAt: null },
      _sum: { goodEggsCount: true },
    }),
    listUpcomingEvents(actor, 3, now),
    prisma.newsReport.findMany({
      select: newsSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    }),
  ]);

  const tasks = taskResult.tasks;
  const completedTasks = tasks.filter((task) => task.currentExecution !== null).length;
  const urgentTasks = tasks.filter(
    (task) => task.frequency === 'URGENT' && task.currentExecution === null,
  );
  const stockAlerts = stockRows
    .map((item) => ({
      id: item.id,
      name: item.name,
      area: item.area,
      unit: item.unit,
      minimumQuantity: item.minimumQuantity.toString(),
      currentQuantity: item.currentQuantity.toString(),
      stockLevel: computeStockLevel(item.currentQuantity, item.minimumQuantity),
    }))
    .filter((item) => item.stockLevel !== 'ok');

  return {
    generatedAt: now.toISOString(),
    today: todayText,
    timeZone: config.businessTimeZone,
    kpis: {
      tasksCompleted: completedTasks,
      tasksTotal: tasks.length,
      urgentPending: urgentTasks.length,
      stockAlerts: stockAlerts.length,
      goodEggsToday: eggAggregate._sum.goodEggsCount ?? 0,
    },
    urgentTasks: urgentTasks.map((task) => ({
      id: task.id,
      description: task.description,
      assignee: task.assignee,
    })),
    performance,
    stockAlerts,
    upcomingEvents: events,
    latestNews: newsRows.map((news) => ({
      id: news.id,
      text: news.text,
      createdAt: news.createdAt.toISOString(),
      employee: news.employee,
    })),
  };
}

export type DashboardResponse = Awaited<ReturnType<typeof getDashboard>>;
