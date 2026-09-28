import { describe, expect, it } from 'vitest';
import {
  birthdayFallsOn,
  birthdayPersonKey,
  birthdayTitle,
  nextBirthday,
  upcomingBirthdays,
  type BirthdayInput,
} from '../../more/birthdays';
import { birthdaySourceRef } from '../../more/eventsService';
import { formatFamilyBirthDate, parseFamilyBirthDate } from '../../more/familyService';
import { buildWeatherReport, gardenRecommendations } from '../../more/weatherService';
import {
  createEmployeeBodySchema,
  createEventBodySchema,
  createFamilyMemberBodySchema,
  createNewsBodySchema,
  updateEmployeeBodySchema,
  updateFamilyMemberBodySchema,
  updatePersonalProfileBodySchema,
  updateProfileBodySchema,
  uploadPhotoQuerySchema,
} from '../../more/moreSchemas';
import { isImageRead } from '../../config/rateLimit';
import { personDisplayNameSchema } from '../../lib/personName';

const TODAY = { year: 2026, month: 9, day: 25 };
const input = (name: string, month: number, day: number): BirthdayInput => ({
  origin: 'USER_FAMILY' as const,
  sourceId: name,
  name,
  month,
  day,
  note: 'Familia',
});

describe('🎂 cumpleaños derivados (nunca filas fijas)', () => {
  it('hoy cuenta como 0 días; uno ya pasado este año se festeja el próximo', () => {
    expect(nextBirthday(input('Hoy', 9, 25), TODAY)).toMatchObject({
      date: '2026-09-25',
      daysUntil: 0,
    });
    expect(nextBirthday(input('Vicky', 3, 10), TODAY)).toMatchObject({ date: '2027-03-10' });
    expect(nextBirthday(input('Felicitas', 6, 1), TODAY).date).toBe('2027-06-01');
  });

  it('un 29/02 se festeja el 01/03 en años no bisiestos (misma regla que Mascotas)', () => {
    expect(nextBirthday(input('Bisiesto', 2, 29), TODAY).date).toBe('2027-03-01');
    expect(nextBirthday(input('Bisiesto', 2, 29), { year: 2028, month: 1, day: 1 }).date).toBe(
      '2028-02-29',
    );
  });

  it('ordena por proximidad y luego por nombre', () => {
    const list = upcomingBirthdays(
      [input('B', 10, 1), input('A', 10, 1), input('C', 9, 30)],
      TODAY,
    );
    expect(list.map((item) => item.name)).toEqual(['C', 'A', 'B']);
  });

  it('cambio de año: el 31/12 cuenta el 01/01 siguiente como mañana y el 31/12 como hoy', () => {
    const newYearsEve = { year: 2026, month: 12, day: 31 };
    expect(nextBirthday(input('Año nuevo', 1, 1), newYearsEve)).toMatchObject({
      date: '2027-01-01',
      daysUntil: 1,
    });
    expect(nextBirthday(input('Fin de año', 12, 31), newYearsEve).daysUntil).toBe(0);
    expect(nextBirthday(input('Ayer', 12, 30), newYearsEve).date).toBe('2027-12-30');
  });

  it('29/02: cae el 01/03 en años no bisiestos y el 29/02 en bisiestos', () => {
    expect(birthdayFallsOn({ month: 2, day: 29 }, { year: 2027, month: 3, day: 1 })).toBe(true);
    expect(birthdayFallsOn({ month: 2, day: 29 }, { year: 2028, month: 2, day: 29 })).toBe(true);
    expect(birthdayFallsOn({ month: 2, day: 29 }, { year: 2028, month: 3, day: 1 })).toBe(false);
    expect(birthdayFallsOn({ month: 3, day: 10 }, { year: 2027, month: 3, day: 10 })).toBe(true);
  });

  it('título: "Cumpleaños de <nombre>"; sin nombre, el título de respaldo', () => {
    expect(birthdayTitle(input('Vicky', 3, 10))).toBe('Cumpleaños de Vicky');
    expect(
      birthdayTitle({
        ...input('x', 1, 1),
        name: null,
        fallbackTitle: 'Cumpleaños del administrador',
      }),
    ).toBe('Cumpleaños del administrador');
  });

  it('clave de persona: sin mayúsculas, espacios extra, 🎂 ni el prefijo "Cumpleaños de"', () => {
    expect(birthdayPersonKey('🎂 Cumpleaños de  Vicky ')).toBe('vicky');
    expect(birthdayPersonKey('cumpleaños de vicky')).toBe('vicky');
    expect(birthdayPersonKey('VICKY')).toBe('vicky');
    expect(birthdayPersonKey('Cumple de Ana María')).toBe('ana maría');
    expect(birthdayPersonKey('Visita de Vicky')).toBe('visita de vicky');
  });
});

describe('👨‍👩‍👧‍👦 fechas de familiares (año opcional, nunca inventado)', () => {
  const today = { year: 2026, month: 9, day: 28 };
  it('YYYY-MM-DD conserva el año; --MM-DD no inventa ninguno', () => {
    expect(parseFamilyBirthDate('1990-03-10', today)).toEqual({ month: 3, day: 10, year: 1990 });
    expect(parseFamilyBirthDate('--03-10', today)).toEqual({ month: 3, day: 10, year: null });
    expect(formatFamilyBirthDate({ month: 3, day: 10, year: null })).toBe('--03-10');
    expect(formatFamilyBirthDate({ month: 6, day: 1, year: 2001 })).toBe('2001-06-01');
  });

  it('29/02 sin año se admite; con año solo si es bisiesto; fechas imposibles o futuras no', () => {
    expect(parseFamilyBirthDate('--02-29', today)).toEqual({ month: 2, day: 29, year: null });
    expect(parseFamilyBirthDate('2000-02-29', today).year).toBe(2000);
    for (const bad of ['2001-02-29', '--02-30', '--13-01', '1899-12-31', '2026-09-29']) {
      expect(() => parseFamilyBirthDate(bad, today), bad).toThrow();
    }
  });

  it('contratos .strict(): nunca aceptan userId ni ownerUserId', () => {
    const body = { name: 'Ana', relation: 'CHILD', birthDate: '2010-05-04' };
    expect(createFamilyMemberBodySchema.safeParse(body).success).toBe(true);
    expect(createFamilyMemberBodySchema.safeParse({ ...body, ownerUserId: 'x' }).success).toBe(
      false,
    );
    expect(createFamilyMemberBodySchema.safeParse({ ...body, relation: 'SELF' }).success).toBe(
      false,
    );
    expect(updateFamilyMemberBodySchema.safeParse({ userId: 'x' }).success).toBe(false);
    expect(updateFamilyMemberBodySchema.safeParse({}).success).toBe(false);
    expect(
      updatePersonalProfileBodySchema.safeParse({ displayName: 'Ana', birthDate: '', userId: 'x' })
        .success,
    ).toBe(false);
    expect(
      updatePersonalProfileBodySchema.safeParse({ displayName: '', birthDate: '' }).success,
    ).toBe(false);
    expect(
      updatePersonalProfileBodySchema.parse({ displayName: '  Ana  ', birthDate: '' }),
    ).toEqual({ displayName: 'Ana', birthDate: null });
  });
});

describe('🔗 enlace a la fuente de un cumpleaños derivado (según quién mira)', () => {
  const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
  const employee = { userId: 'u-emp', role: 'EMPLOYEE' as const, employeeId: 'emp-1' };
  const of = (origin: BirthdayInput['origin'], extra: Partial<BirthdayInput> = {}) => ({
    ...input('X', 1, 1),
    origin,
    sourceId: 'src-1',
    ...extra,
  });

  it('perfil y familia propios → Mi perfil; ajenos → nada (el EMPLOYEE no ve la familia del ADMIN)', () => {
    const family = of('USER_FAMILY', { ownerUserId: 'u-admin' });
    expect(birthdaySourceRef(family, admin)).toEqual({ kind: 'MY_PROFILE' });
    expect(birthdaySourceRef(family, employee)).toBeNull();
    expect(birthdaySourceRef(of('USER_PROFILE', { ownerUserId: 'u-admin' }), employee)).toBeNull();
  });

  it('empleado/hijo: el propio → Mi perfil; ADMIN → Datos del equipo; otro EMPLOYEE → nada', () => {
    const child = of('EMPLOYEE_CHILD', { employeeId: 'emp-1' });
    expect(birthdaySourceRef(child, employee)).toEqual({ kind: 'MY_PROFILE' });
    expect(birthdaySourceRef(child, admin)).toEqual({ kind: 'TEAM_PROFILES' });
    expect(birthdaySourceRef(of('EMPLOYEE', { employeeId: 'emp-2' }), employee)).toBeNull();
  });

  it('mascota → su ficha; global → nada', () => {
    expect(birthdaySourceRef(of('ANIMAL'), employee)).toEqual({ kind: 'PET', id: 'src-1' });
    expect(birthdaySourceRef(of('GLOBAL_RECURRING'), admin)).toBeNull();
  });
});

function weather(overrides: {
  max?: number;
  rain?: [number, number];
  wind?: number;
  now?: number;
}) {
  return {
    current: {
      temperature_2m: 21.4,
      relative_humidity_2m: 60,
      apparent_temperature: 20.6,
      precipitation: overrides.now ?? 0,
      weather_code: 2,
      wind_speed_10m: overrides.wind ?? 10,
    },
    daily: {
      time: ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'],
      weather_code: [2, 61, 0, 3, 95],
      temperature_2m_max: [overrides.max ?? 24, 22, 20, 19, 18],
      temperature_2m_min: [12, 11, 10, 9, 8],
      precipitation_sum: [...(overrides.rain ?? [0, 0]), 0, 0, 0],
      precipitation_probability_max: [10, 80, null, 5, 40],
    },
  };
}

describe('🌤️ recomendaciones de jardín (reglas de rndClima)', () => {
  const texts = (data: ReturnType<typeof weather>) =>
    gardenRecommendations(data).map((r) => r.text);

  it('sin lluvia hoy ni mañana: regar', () => {
    expect(texts(weather({}))).toEqual(['Regar hoy — no se esperan lluvias']);
  });
  it('llovió hoy: no regar; lluvia mañana: no fumigar', () => {
    expect(texts(weather({ rain: [5, 0] }))).toEqual(['No regar hoy — lluvia suficiente']);
    expect(texts(weather({ rain: [0, 3] }))).toEqual(['No fumigar — lluvia prevista mañana']);
  });
  it('calor, viento y frío suman avisos con los umbrales del prototipo', () => {
    expect(texts(weather({ max: 33, wind: 26 }))).toContain(
      'Calor intenso — regar temprano a la mañana',
    );
    expect(texts(weather({ max: 33, wind: 26 }))).toContain(
      'Viento fuerte — evitar fumigación hoy',
    );
    expect(texts(weather({ max: 9 }))).toContain('Frío — proteger plantas sensibles');
  });
  it('arma el informe con íconos y descripciones del prototipo, 5 días y lluvia actual', () => {
    const report = buildWeatherReport(
      'Villa Elisa, Entre Ríos',
      weather({ now: 0.4 }),
      new Date(0),
    );
    expect(report.current).toMatchObject({
      temperature: 21,
      apparentTemperature: 21,
      icon: '⛅',
      description: 'Parcialm. nublado',
      raining: true,
    });
    expect(report.forecast).toHaveLength(5);
    expect(report.forecast[4]).toMatchObject({ icon: '⛈️', precipitationProbability: 40 });
    expect(report.forecast[2]?.precipitationProbability).toBeNull();
  });
});

describe('schemas de Más (.strict())', () => {
  it('novedad: rechaza campos no previstos (nunca el actor ni la fecha desde el cliente)', () => {
    expect(createNewsBodySchema.safeParse({ text: 'Hola', recordedByUserId: 'x' }).success).toBe(
      false,
    );
    expect(createNewsBodySchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(createNewsBodySchema.safeParse({ text: '<b>x</b>' }).success).toBe(false);
  });
  it('evento: tipo del enum, fecha con formato y nota vacía = null', () => {
    const parsed = createEventBodySchema.parse({
      title: 'Visita',
      date: '2026-10-01',
      type: 'VISIT',
      note: '',
    });
    expect(parsed.note).toBeNull();
    expect(
      createEventBodySchema.safeParse({ title: 'X', date: '1/10/2026', type: 'VISIT' }).success,
    ).toBe(false);
    expect(
      createEventBodySchema.safeParse({ title: 'X', date: '2026-10-01', type: 'PARTY' }).success,
    ).toBe(false);
  });
  it('foto: título vacío = "Sin título" (prototipo) y tipo obligatorio', () => {
    expect(uploadPhotoQuerySchema.parse({ category: 'MEMORY' }).title).toBe('Sin título');
    expect(uploadPhotoQuerySchema.parse({ category: 'MEMORY', title: '' }).title).toBe(
      'Sin título',
    );
    expect(uploadPhotoQuerySchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(uploadPhotoQuerySchema.safeParse({ category: 'ANIMAL_PROFILE' }).success).toBe(false);
  });
  it('perfil: formulario completo, vacíos a null, teléfono y CUIL con formato razonable', () => {
    const base = {
      fullLegalName: '',
      birthDate: '',
      maritalStatus: '',
      phone: '',
      taxId: '',
      healthInsurance: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
    };
    expect(updateProfileBodySchema.safeParse(base).success).toBe(false); // el nombre es obligatorio
    const { displayName, ...rest } = updateProfileBodySchema.parse({
      ...base,
      displayName: ' Coke ',
    });
    expect(displayName).toBe('Coke');
    expect(Object.values(rest).every((value) => value === null)).toBe(true);
    const named = { ...base, displayName: 'Coke' };
    for (const field of ['userId', 'employeeId', 'username', 'role', 'code', 'status', 'active']) {
      expect(updateProfileBodySchema.safeParse({ ...named, [field]: 'x' }).success, field).toBe(
        false,
      );
    }
    expect(updateProfileBodySchema.safeParse({ ...named, phone: 'llamame' }).success).toBe(false);
    expect(updateProfileBodySchema.safeParse({ ...named, taxId: '27-1234x' }).success).toBe(false);
    expect(updateProfileBodySchema.safeParse({ ...named, maritalStatus: 'Otro' }).success).toBe(
      false,
    );
    expect(updateProfileBodySchema.safeParse({ ...base, employeeId: 'x' }).success).toBe(false);
    expect(
      updateProfileBodySchema.parse({ ...named, phone: '3442 123456', taxId: '27-12345678-9' }),
    ).toMatchObject({ phone: '3442 123456', taxId: '27-12345678-9' });
  });
});

describe('🪪 nombre visible — validación única compartida', () => {
  const ok = (value: string) => personDisplayNameSchema.safeParse(value);
  it('normaliza espacios y admite nombres reales en español', () => {
    expect(personDisplayNameSchema.parse('  María   José  ')).toBe('María José');
    for (const name of [
      'Coke',
      'Cami',
      'Ruth',
      'Pablo',
      'Ñandú Peña',
      'O’Dwyer',
      "D'Angelo",
      'Ana-Lía',
      'María J.',
      'Güemes',
      'Jo',
    ]) {
      expect(ok(name).success, name).toBe(true);
    }
  });

  it('rechaza vacío, 1 letra, > 100, dígitos, símbolos, HTML y caracteres de control', () => {
    const cases: [string, RegExp][] = [
      ['   ', /Ingresá el nombre/],
      ['A', /al menos 2 letras/],
      ['--', /al menos 2 letras/],
      ['a'.repeat(101), /100 caracteres/],
      ['Ana2', /solo puede tener letras/],
      ['<b>Ana</b>', /solo puede tener letras/],
      [`Ana${String.fromCharCode(0)}`, /solo puede tener letras/],
      ['Ana 😀', /solo puede tener letras/],
    ];
    for (const [value, message] of cases) {
      const parsed = ok(value);
      expect(parsed.success, value).toBe(false);
      expect(parsed.error?.issues[0]?.message).toMatch(message);
    }
    expect(ok('a'.repeat(100)).success).toBe(true);
  });

  it('alta y edición de personas usan la misma validación (sin unicidad)', () => {
    expect(
      createEmployeeBodySchema.safeParse({ displayName: 'Ana2', role: 'Otro', colorHex: '#4a7c59' })
        .success,
    ).toBe(false);
    expect(updateEmployeeBodySchema.parse({ displayName: '  Ana   Lía ' })).toEqual({
      displayName: 'Ana Lía',
    });
    expect(updateEmployeeBodySchema.safeParse({ displayName: 'x'.repeat(60) }).success).toBe(true);
  });
});

describe('cupo propio de lecturas de imágenes', () => {
  it('solo los GET de los proxies de imagen cuentan en ese cupo', () => {
    expect(isImageRead({ method: 'GET', path: '/photos/abc/content' })).toBe(true);
    expect(isImageRead({ method: 'GET', path: '/pets/photos/abc' })).toBe(true);
    expect(isImageRead({ method: 'GET', path: '/photos' })).toBe(false);
    expect(isImageRead({ method: 'POST', path: '/photos/abc/content' })).toBe(false);
    expect(isImageRead({ method: 'GET', path: '/news' })).toBe(false);
  });
});
