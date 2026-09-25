import type {
  EventsResponse,
  ManagedEmployee,
  MoreSummary,
  MyProfileResponse,
  NewsListResponse,
  PhotosListResponse,
  TeamMember,
  WeatherReport,
} from '../../api/moreTypes';

/** Datos SINTÉTICOS solo para tests de ☰ Más (nunca se empaquetan: guarda en styles.test.ts). */

export const PERSON = { id: 'emp-sint-1', displayName: 'Persona sintética', colorHex: '#4a7c59' };

export const summaryResponse = (overrides: Partial<MoreSummary> = {}): MoreSummary => ({
  news: { today: 2, total: 7 },
  events: { upcoming: 3 },
  photos: { total: 1 },
  ...overrides,
});

export const newsResponse = (count = 1): NewsListResponse => ({
  news: Array.from({ length: count }, (_, index) => ({
    id: `news-${index}`,
    text: `Aviso sintético ${index}`,
    createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    employee: PERSON,
  })),
  page: 1,
  pageSize: 20,
  total: count,
  totalPages: 1,
});

export const eventsResponse = (): EventsResponse => ({
  today: '2026-09-25',
  upcoming: [
    {
      kind: 'event',
      id: 'ev-1',
      title: 'Visita sintética',
      date: '2026-09-26',
      type: 'VISIT',
      note: 'Nota sintética',
      daysUntil: 1,
    },
    {
      kind: 'birthday',
      id: 'family:1',
      title: 'Cumpleaños de Familiar sintético',
      date: '2026-10-05',
      type: 'BIRTHDAY',
      note: 'Familia',
      daysUntil: 10,
      source: 'FAMILY',
    },
  ],
  past: {
    items: [
      {
        kind: 'event',
        id: 'ev-0',
        title: 'Mantenimiento sintético',
        date: '2026-09-20',
        type: 'MAINTENANCE',
        note: null,
        daysUntil: -5,
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
  },
});

export const weatherResponse = (): WeatherReport => ({
  location: { label: 'Ubicación sintética' },
  current: {
    temperature: 21,
    apparentTemperature: 20,
    humidity: 60,
    windSpeed: 12,
    raining: true,
    description: 'Parcialm. nublado',
    icon: '⛅',
  },
  forecast: ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'].map(
    (date, index) => ({
      date,
      icon: '☀️',
      max: 20 + index,
      min: 10,
      precipitationProbability: index === 1 ? 80 : 5,
    }),
  ),
  recommendations: [{ icon: '💧', text: 'Regar hoy — no se esperan lluvias' }],
  fetchedAt: '2026-09-25T12:00:00.000Z',
});

export const photosResponse = (
  storage: 'configured' | 'unconfigured' = 'configured',
): PhotosListResponse => ({
  photos: [
    {
      id: 'photo-1',
      title: 'Foto sintética',
      category: 'MEMORY',
      createdAt: new Date().toISOString(),
      employee: PERSON,
    },
  ],
  page: 1,
  pageSize: 24,
  total: 1,
  totalPages: 1,
  photoStorage: storage,
});

export const employeesResponse = (): { employees: ManagedEmployee[] } => ({
  employees: [
    {
      ...PERSON,
      role: 'Doméstica',
      active: true,
      account: { userId: 'user-sint-1', status: 'ACTIVE', hasPin: true },
    },
    {
      id: 'emp-sint-2',
      displayName: 'Otra sintética',
      role: 'Parque',
      colorHex: '#2c5364',
      active: false,
      account: { userId: 'user-sint-2', status: 'PENDING_ACTIVATION', hasPin: false },
    },
  ],
});

export const teamResponse = (): { team: TeamMember[] } => ({
  team: [
    {
      ...PERSON,
      role: 'Doméstica',
      complete: true,
      profile: {
        fullLegalName: 'Nombre completo sintético',
        birthDate: '1990-05-04',
        maritalStatus: null,
        phone: '0000 000000',
        taxId: null,
        healthInsurance: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
      },
      children: [
        {
          id: 'child-1',
          name: 'Hijo sintético',
          birthDate: '2020-01-15',
          age: { years: 6, months: 80 },
        },
      ],
    },
  ],
});

export const profileResponse = (): MyProfileResponse => ({
  employee: { ...PERSON, role: 'Doméstica' },
  profile: null,
  children: [],
});
