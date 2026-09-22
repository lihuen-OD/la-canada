/**
 * Punto de entrada único al inventario de datos reales del seed. Deliberadamente
 * sin ningún import de `@prisma/client` ni de `PrismaClient`: estos módulos son
 * datos puros (arrays/objetos TypeScript), importables y testeables sin
 * conexión a PostgreSQL — ver backend/src/test/seed-data.test.ts.
 */
export { employeeSeeds, type EmployeeSeed } from './employees';
export { userSeeds, type UserSeed } from './users';
export { taskSeeds, type TaskSeed } from './tasks';
export {
  stockCategorySeeds,
  stockItemSeeds,
  type StockCategorySeed,
  type StockItemSeed,
} from './stock';
export { newsReportSeeds, type NewsReportSeed } from './newsReports';
export { eventSeeds, type EventSeed } from './events';
export {
  recurringBirthdaySeeds,
  OMITTED_BENJAMIN_BIRTHDAY,
  type RecurringBirthdaySeed,
} from './recurringBirthdays';
export { animalTypeSeeds, type AnimalTypeSeed } from './animalTypes';
export { propertyLocationSeed, type PropertyLocationSeed } from './propertyLocation';
export { normalizeUsername } from './normalize';
