import { describe, expect, it } from 'vitest';
import { nextBirthday, upcomingBirthdays } from '../../more/birthdays';
import { buildWeatherReport, gardenRecommendations } from '../../more/weatherService';
import {
  createEventBodySchema,
  createNewsBodySchema,
  updateProfileBodySchema,
  uploadPhotoQuerySchema,
} from '../../more/moreSchemas';
import { isImageRead } from '../../config/rateLimit';

const TODAY = { year: 2026, month: 9, day: 25 };
const input = (name: string, month: number, day: number) => ({
  source: 'FAMILY' as const,
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
    expect(
      Object.values(updateProfileBodySchema.parse(base)).every((value) => value === null),
    ).toBe(true);
    expect(updateProfileBodySchema.safeParse({ ...base, phone: 'llamame' }).success).toBe(false);
    expect(updateProfileBodySchema.safeParse({ ...base, taxId: '27-1234x' }).success).toBe(false);
    expect(updateProfileBodySchema.safeParse({ ...base, maritalStatus: 'Otro' }).success).toBe(
      false,
    );
    expect(updateProfileBodySchema.safeParse({ ...base, employeeId: 'x' }).success).toBe(false);
    expect(
      updateProfileBodySchema.parse({ ...base, phone: '3442 123456', taxId: '27-12345678-9' }),
    ).toMatchObject({ phone: '3442 123456', taxId: '27-12345678-9' });
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
