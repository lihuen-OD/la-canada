import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reglas de ☰ Más con un Prisma simulado mínimo: permisos por rol, persona
 * según la sesión, anulación lógica, idempotencia de la subida de fotos,
 * revocación de sesiones al dar de baja una persona, auditorías sin datos
 * personales y la caché del clima. La SQL real se prueba contra `demo` en
 * `more.integration.test.ts`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    employee: {
      findUnique: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      updateMany: fn(),
      findUniqueOrThrow: fn(),
    },
    user: { findMany: fn(), create: fn() },
    session: { updateMany: fn() },
    newsReport: { create: fn(), count: fn(), findMany: fn() },
    event: { create: fn(), findFirst: fn(), update: fn(), updateMany: fn() },
    fileAsset: {
      create: fn(),
      update: fn(),
      updateMany: fn(),
      findFirst: fn(),
      findUniqueOrThrow: fn(),
    },
    idempotencyRecord: { findUnique: fn(), create: fn(), update: fn() },
    employeeProfile: { findUnique: fn(), upsert: fn() },
    employeeChild: { findMany: fn(), create: fn(), deleteMany: fn() },
    propertyLocation: { findUnique: fn() },
    auditLog: { create: fn() },
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { canonicalRequestHash } from '../../lib/idempotency';
import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';
import type { TaskActor } from '../../tasks/tasksService';
import { createNews } from '../../more/newsService';
import { createEvent, deleteEvent, updateEvent } from '../../more/eventsService';
import { deletePhoto, uploadPhoto } from '../../more/photosService';
import { createEmployee, setEmployeeActive, updateEmployee } from '../../more/employeesService';
import { addMyChild, removeMyChild, updateMyProfile } from '../../more/profileService';
import { getWeather, setWeatherFetcherForTests } from '../../more/weatherService';

const META = { ipAddress: null, userAgent: 'vitest' };
const ID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const EMPLOYEE: TaskActor = { userId: 'user-e', role: 'EMPLOYEE', employeeId: 'emp-1' };
const ADMIN: TaskActor = { userId: 'user-a', role: 'ADMIN', employeeId: null };
const NOW = new Date('2026-09-26T02:30:00Z'); // 23:30 del 25/09 en Buenos Aires
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const audits = () => db.auditLog.create.mock.calls.map((call) => call[0].data);

function fakeStorage(overrides: Partial<ObjectStorageClient> = {}) {
  return {
    bucket: 'bucket-test',
    putObject: vi.fn(async () => ({ etag: '"e"' })),
    getObject: vi.fn(async () => ({ body: JPEG, contentType: 'image/jpeg', etag: null })),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.auditLog.create.mockResolvedValue({});
  setObjectStorageForTests(null);
});
afterEach(() => setObjectStorageForTests(undefined));

describe('📝 Novedades — "¿Quién reporta?" según la sesión', () => {
  const row = (employeeId: string) => ({
    id: ID,
    text: 'Se cortó la luz',
    createdAt: NOW,
    employee: { id: employeeId, displayName: 'Coke', colorHex: '#4a7c59' },
  });

  it('EMPLOYEE: queda fijado a su empleado; nombrar a otra persona es 403 sin tocar la base', async () => {
    db.employee.findUnique.mockResolvedValue({ active: true });
    db.newsReport.create.mockResolvedValue(row('emp-1'));
    await createNews(EMPLOYEE, { text: 'Se cortó la luz' }, META);
    expect(db.newsReport.create.mock.calls[0]?.[0].data).toMatchObject({
      employeeId: 'emp-1',
      recordedByUserId: 'user-e',
    });
    await expect(
      createNews(EMPLOYEE, { text: 'x', employeeId: OTHER }, META),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(db.newsReport.create).toHaveBeenCalledTimes(1);
  });

  it('ADMIN sin empleado: debe elegir una persona activa; el actor real queda aparte', async () => {
    await expect(createNews(ADMIN, { text: 'x' }, META)).rejects.toMatchObject({ statusCode: 400 });
    db.employee.findUnique.mockResolvedValueOnce({ active: false });
    await expect(createNews(ADMIN, { text: 'x', employeeId: OTHER }, META)).rejects.toMatchObject({
      code: 'EMPLOYEE_INVALID',
    });
    db.employee.findUnique.mockResolvedValueOnce({ active: true });
    db.newsReport.create.mockResolvedValue(row(OTHER));
    await createNews(ADMIN, { text: 'x', employeeId: OTHER }, META);
    expect(audits().at(-1)).toMatchObject({
      action: 'news.created',
      actorUserId: 'user-a',
      newState: { employeeId: OTHER, chosenByAdmin: true },
    });
  });
});

describe('📅 Eventos — solo ADMIN, sin duplicados, "eliminar" es anulación', () => {
  const event = {
    id: ID,
    title: 'Visita',
    date: new Date('2026-10-01T00:00:00Z'),
    type: 'VISIT',
    note: null,
  };

  it.each([
    [
      'crear',
      () =>
        createEvent(EMPLOYEE, { title: 'X', date: '2026-10-01', type: 'VISIT', note: null }, META),
    ],
    ['editar', () => updateEvent(EMPLOYEE, ID, { title: 'X' }, META)],
    ['eliminar', () => deleteEvent(EMPLOYEE, ID, META)],
  ])('EMPLOYEE no puede %s', async (_label, run) => {
    await expect(run()).rejects.toMatchObject({ statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('un duplicado vigente (P2002) es 409 propio, nunca un error de Prisma', async () => {
    db.event.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(
      createEvent(ADMIN, { title: 'Visita', date: '2026-10-01', type: 'VISIT', note: null }, META),
    ).rejects.toMatchObject({ code: 'EVENT_DUPLICATE', statusCode: 409 });
  });

  it('rechaza fechas inexistentes', async () => {
    await expect(
      createEvent(ADMIN, { title: 'X', date: '2026-02-30', type: 'VISIT', note: null }, META),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('eliminar marca la fila (nunca la borra) y un segundo pedido es 404', async () => {
    db.event.findFirst.mockResolvedValueOnce(event);
    db.event.updateMany.mockResolvedValueOnce({ count: 1 });
    await deleteEvent(ADMIN, ID, META, NOW);
    expect(db.event.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: ID, deletedAt: null },
      data: { deletedAt: NOW, deletedByUserId: 'user-a' },
    });
    expect(audits()[0]).toMatchObject({ action: 'event.deleted' });
    db.event.findFirst.mockResolvedValueOnce(null);
    await expect(deleteEvent(ADMIN, ID, META, NOW)).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
    });
  });
});

describe('📸 Fotos — subida validada, idempotente y borrado solo ADMIN', () => {
  const metadata = { title: 'Jardín', category: 'MEMORY' as const, employeeId: undefined };
  const upload = (actor: TaskActor, key?: string, body: Buffer = JPEG, type = 'image/jpeg') =>
    uploadPhoto(actor, { body, declaredType: type, filename: 'x.jpg' }, metadata, META, key, NOW);
  const saved = {
    id: ID,
    title: 'Jardín',
    category: 'MEMORY',
    createdAt: NOW,
    taggedEmployee: null,
  };

  it('sin almacenamiento configurado: 503 claro, sin tocar la base', async () => {
    await expect(upload(EMPLOYEE)).rejects.toMatchObject({ code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });

  it('el tipo real sale de los bytes: un PNG declarado como JPEG, o un SVG, se rechaza', async () => {
    setObjectStorageForTests(fakeStorage());
    await expect(upload(EMPLOYEE, undefined, JPEG, 'image/png')).rejects.toMatchObject({
      statusCode: 415,
    });
    await expect(
      upload(EMPLOYEE, undefined, Buffer.from('<svg/>'), 'image/svg+xml'),
    ).rejects.toMatchObject({
      statusCode: 415,
    });
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });

  it('EMPLOYEE sube: clave generada por el backend, AVAILABLE recién tras el PUT, auditado', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    db.fileAsset.create.mockResolvedValue({ id: ID });
    db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    db.fileAsset.findUniqueOrThrow.mockResolvedValue(saved);
    const result = await upload(EMPLOYEE);
    expect(result).toMatchObject({ kind: 'created', body: { photo: { id: ID, title: 'Jardín' } } });
    const key = db.fileAsset.create.mock.calls[0]?.[0].data.objectKey as string;
    expect(key).toMatch(/^memories\/2026\/[0-9a-f-]{36}\.jpg$/);
    expect(storage.putObject).toHaveBeenCalledWith(key, JPEG, 'image/jpeg');
    expect(db.fileAsset.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ID, status: 'PENDING_UPLOAD' },
      data: { status: 'AVAILABLE' },
    });
    expect(audits()[0]).toMatchObject({ action: 'photo.uploaded', actorUserId: 'user-e' });
  });

  it('el proveedor falla: UPLOAD_FAILED y 502 reintentable', async () => {
    setObjectStorageForTests(
      fakeStorage({
        putObject: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
    );
    db.fileAsset.create.mockResolvedValue({ id: ID });
    await expect(upload(EMPLOYEE)).rejects.toMatchObject({ code: 'OBJECT_STORAGE_UNAVAILABLE' });
    expect(db.fileAsset.update.mock.calls[0]?.[0].data).toEqual({ status: 'UPLOAD_FAILED' });
  });

  it('un reintento con la misma clave ya resuelto responde el original sin volver a subir', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    const checksum = createHash('sha256').update(JPEG).digest('hex');
    db.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: canonicalRequestHash(['POST /photos', checksum, 'MEMORY', null, 'Jardín']),
      responseStatus: 201,
      responseBody: { photo: { id: ID } },
      completedAt: NOW,
    });
    const result = await upload(EMPLOYEE, 'clave-idempotente-123');
    expect(result).toEqual({ kind: 'replay', status: 201, body: { photo: { id: ID } } });
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(db.fileAsset.create).not.toHaveBeenCalled();
  });

  it('la misma clave con otra imagen o metadatos es 409, sin subir nada', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    db.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: 'otra-huella',
      responseStatus: 201,
      responseBody: {},
      completedAt: NOW,
    });
    await expect(upload(EMPLOYEE, 'clave-idempotente-123')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('eliminar: EMPLOYEE 403 (diferencia aprobada); ADMIN = baja lógica y luego borrado físico', async () => {
    const storage = fakeStorage();
    setObjectStorageForTests(storage);
    await expect(deletePhoto(EMPLOYEE, ID, META)).rejects.toMatchObject({ statusCode: 403 });
    db.fileAsset.findFirst.mockResolvedValue({
      id: ID,
      objectKey: 'memories/2026/x.jpg',
      category: 'MEMORY',
      taggedEmployeeId: null,
    });
    db.fileAsset.updateMany.mockResolvedValue({ count: 1 });
    await deletePhoto(ADMIN, ID, META, NOW);
    expect(db.fileAsset.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: ID, status: 'AVAILABLE' },
      data: { status: 'PENDING_DELETION', deletedAt: NOW },
    });
    expect(storage.deleteObject).toHaveBeenCalledWith('memories/2026/x.jpg');
    expect(db.fileAsset.updateMany.mock.calls[1]?.[0]).toMatchObject({
      where: { id: ID, status: 'PENDING_DELETION' },
      data: { status: 'DELETED' },
    });
  });
});

describe('⚙️ Personas (solo ADMIN)', () => {
  const employeeRow = {
    id: ID,
    displayName: 'Coke',
    role: 'Doméstica',
    colorHex: '#4a7c59',
    active: false,
    user: { id: 'user-coke', status: 'ACTIVE' },
  };

  it.each([
    [
      'agregar',
      () => createEmployee(EMPLOYEE, { displayName: 'X', role: 'Otro', colorHex: '#000000' }, META),
    ],
    ['editar', () => updateEmployee(EMPLOYEE, ID, { displayName: 'X' }, META)],
    ['dar de baja', () => setEmployeeActive(EMPLOYEE, ID, false, META)],
  ])('EMPLOYEE no puede %s', async (_label, run) => {
    await expect(run()).rejects.toMatchObject({ statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('alta: clave estable libre y cuenta EMPLOYEE pendiente, sin PIN', async () => {
    db.employee.findMany.mockResolvedValue([{ code: 'coke' }]);
    db.user.findMany.mockResolvedValue([{ username: 'coke' }, { username: 'coke-2' }]);
    db.employee.create.mockResolvedValue({ id: ID });
    db.user.create.mockResolvedValue({ id: 'u-new' });
    db.employee.findUniqueOrThrow.mockResolvedValue({
      ...employeeRow,
      active: true,
      user: { id: 'u-new', status: 'PENDING_ACTIVATION' },
    });
    const result = await createEmployee(
      ADMIN,
      { displayName: 'Coké', role: 'Doméstica', colorHex: '#4a7c59' },
      META,
    );
    expect(db.employee.create.mock.calls[0]?.[0].data.code).toBe('coke-3');
    expect(db.user.create.mock.calls[0]?.[0].data).toEqual({
      username: 'coke-3',
      role: 'EMPLOYEE',
      status: 'PENDING_ACTIVATION',
      employeeId: ID,
    });
    expect(result.employee.account).toEqual({
      userId: 'u-new',
      status: 'PENDING_ACTIVATION',
      hasPin: false,
    });
  });

  it('baja: desactiva y revoca las sesiones abiertas de esa persona (auditado)', async () => {
    db.employee.findUnique.mockResolvedValue({ active: true, user: { id: 'user-coke' } });
    db.employee.updateMany.mockResolvedValue({ count: 1 });
    db.session.updateMany.mockResolvedValue({ count: 2 });
    db.employee.findUniqueOrThrow.mockResolvedValue(employeeRow);
    await setEmployeeActive(ADMIN, ID, false, META, NOW);
    expect(db.session.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { userId: 'user-coke', revokedAt: null },
      data: { revokedAt: NOW },
    });
    expect(audits()[0]).toMatchObject({
      action: 'employee.deactivated',
      newState: { active: false, revokedSessions: 2 },
    });
  });

  it('reactivar no revoca nada', async () => {
    db.employee.findUnique.mockResolvedValue({ active: false, user: { id: 'user-coke' } });
    db.employee.updateMany.mockResolvedValue({ count: 1 });
    db.employee.findUniqueOrThrow.mockResolvedValue({ ...employeeRow, active: true });
    await setEmployeeActive(ADMIN, ID, true, META, NOW);
    expect(db.session.updateMany).not.toHaveBeenCalled();
  });
});

describe('👤 Mi perfil — siempre la persona de la sesión', () => {
  const form = {
    fullLegalName: 'María González',
    birthDate: '1990-05-04',
    maritalStatus: null,
    phone: '3442 123456',
    taxId: null,
    healthInsurance: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
  };

  it('sin empleado vinculado no hay perfil', async () => {
    await expect(updateMyProfile(ADMIN, form, META, NOW)).rejects.toMatchObject({
      code: 'EMPLOYEE_LINK_REQUIRED',
    });
  });

  it('guarda el formulario del propio empleado; la auditoría lista campos, nunca valores', async () => {
    db.employeeProfile.findUnique.mockResolvedValueOnce(null).mockResolvedValue(null);
    db.employeeProfile.upsert.mockResolvedValue({});
    db.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      displayName: 'Coke',
      role: 'Doméstica',
      colorHex: '#4a7c59',
    });
    db.employeeChild.findMany.mockResolvedValue([]);
    await updateMyProfile(EMPLOYEE, form, META, NOW);
    expect(db.employeeProfile.upsert.mock.calls[0]?.[0].where).toEqual({ employeeId: 'emp-1' });
    const audit = audits()[0];
    expect(audit).toMatchObject({ action: 'profile.updated', entityId: 'emp-1' });
    expect(audit.newState.changedFields).toEqual(['fullLegalName', 'birthDate', 'phone']);
    expect(JSON.stringify(audit)).not.toMatch(/María|3442|1990/);
  });

  it('una fecha de nacimiento futura se rechaza', async () => {
    await expect(
      updateMyProfile(EMPLOYEE, { ...form, birthDate: '2026-09-26' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      addMyChild(EMPLOYEE, { name: 'Juan', birthDate: '2027-01-01' }, META, undefined, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('un hijo solo se elimina del propio perfil', async () => {
    db.employeeChild.deleteMany.mockResolvedValue({ count: 0 });
    await expect(removeMyChild(EMPLOYEE, ID, META)).rejects.toMatchObject({
      code: 'CHILD_NOT_FOUND',
    });
    expect(db.employeeChild.deleteMany.mock.calls[0]?.[0]).toEqual({
      where: { id: ID, employeeId: 'emp-1' },
    });
  });
});

describe('🌤️ Clima — caché compartida y una sola consulta en vuelo', () => {
  const payload = {
    current: {
      temperature_2m: 20,
      relative_humidity_2m: 50,
      apparent_temperature: 19,
      precipitation: 0,
      weather_code: 0,
      wind_speed_10m: 5,
    },
    daily: {
      time: ['2026-09-25', '2026-09-26'],
      weather_code: [0, 1],
      temperature_2m_max: [22, 23],
      temperature_2m_min: [10, 11],
      precipitation_sum: [0, 0],
      precipitation_probability_max: [0, 10],
    },
  };
  afterEach(() => setWeatherFetcherForTests(null));

  it('dos pedidos simultáneos y uno posterior dentro de 10 min = una sola llamada a Open-Meteo', async () => {
    db.propertyLocation.findUnique.mockResolvedValue({
      label: 'Villa Elisa, Entre Ríos',
      latitude: -32.15,
      longitude: -58.4,
    });
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify(payload)));
    setWeatherFetcherForTests(fetcher);
    const [a, b] = await Promise.all([getWeather(NOW), getWeather(NOW)]);
    await getWeather(new Date(NOW.getTime() + 5 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/latitude=-32\.15&longitude=-58\.4/);
    expect(a.location.label).toBe('Villa Elisa, Entre Ríos');
  });

  it('una respuesta inválida o una falla de red es 502 reintentable (y no queda cacheada)', async () => {
    db.propertyLocation.findUnique.mockResolvedValue({ label: 'X', latitude: 0, longitude: 0 });
    setWeatherFetcherForTests(vi.fn(async () => new Response('{"current":{}}')));
    await expect(getWeather(NOW)).rejects.toMatchObject({ code: 'WEATHER_UNAVAILABLE' });
    setWeatherFetcherForTests(
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(getWeather(NOW)).rejects.toMatchObject({ code: 'WEATHER_UNAVAILABLE' });
  });
});
