import { config } from '../config';
import { prisma } from '../lib/prisma';
import { formatLocalDate, toLocalDate } from '../lib/businessTime';
import { computeStockLevel } from '../stock/stockLevel';
import { listTasks, listTaskEmployees, type TaskActor } from '../tasks/tasksService';
import { listUpcomingEvents } from '../more/eventsService';

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
 * Inicio replica `rndInicio` del prototipo. Las ramas son independientes y se
 * resuelven en paralelo; la cantidad de sentencias es fija y no depende de
 * tarjetas, personas ni filas devueltas.
 */
export async function getDashboard(actor: TaskActor, now = new Date()) {
  const today = toLocalDate(now, config.businessTimeZone);
  const todayText = formatLocalDate(today);
  const todayDb = new Date(Date.UTC(today.year, today.month - 1, today.day));

  const [taskResult, employeeResult, stockRows, eggAggregate, events, newsRows] = await Promise.all(
    [
      listTasks(actor, { status: 'active' }, now),
      listTaskEmployees(),
      prisma.stockItem.findMany({
        where: { active: true },
        select: stockSelect,
        orderBy: [{ area: 'asc' }, { name: 'asc' }],
      }),
      prisma.eggCollection.aggregate({
        where: { collectionDate: todayDb, voidedAt: null },
        _sum: { goodEggsCount: true },
      }),
      listUpcomingEvents(3, now),
      prisma.newsReport.findMany({
        select: newsSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    ],
  );

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
    teamProgress: employeeResult.employees.map((employee) => {
      const assigned = tasks.filter((task) => task.assignee.id === employee.id);
      const completed = assigned.filter((task) => task.currentExecution !== null).length;
      return {
        employee,
        completed,
        total: assigned.length,
        percentage: assigned.length === 0 ? 0 : Math.round((completed / assigned.length) * 100),
      };
    }),
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
