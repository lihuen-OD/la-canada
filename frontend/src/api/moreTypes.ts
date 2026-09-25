/** Contratos de ☰ Más (Etapa 5X) — espejo de `backend/src/more/*`. */

export interface PersonRef {
  id: string;
  displayName: string;
  colorHex: string;
}

export interface MoreSummary {
  news: { today: number; total: number };
  events: { upcoming: number };
  photos: { total: number };
}

interface Page {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// 📝 Novedades
export interface NewsItem {
  id: string;
  text: string;
  createdAt: string;
  employee: PersonRef;
}
export interface NewsListResponse extends Page {
  news: NewsItem[];
}

// 📅 Eventos
export type EventType = 'VISIT' | 'BIRTHDAY' | 'MAINTENANCE' | 'OTHER';
export type BirthdaySource = 'FAMILY' | 'EMPLOYEE' | 'CHILD' | 'PET';
export interface CalendarEvent {
  kind: 'event';
  id: string;
  title: string;
  date: string;
  type: EventType;
  note: string | null;
  daysUntil: number;
}
export interface BirthdayEvent {
  kind: 'birthday';
  id: string;
  title: string;
  date: string;
  type: 'BIRTHDAY';
  note: string;
  daysUntil: number;
  source: BirthdaySource;
}
export type EventListItem = CalendarEvent | BirthdayEvent;
export interface EventsResponse {
  today: string;
  upcoming: EventListItem[];
  past: Page & { items: CalendarEvent[] };
}
export interface EventFormRequest {
  title: string;
  date: string;
  type: EventType;
  note: string | null;
}

// 🌤️ Clima
export interface WeatherReport {
  location: { label: string };
  current: {
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    windSpeed: number;
    raining: boolean;
    description: string;
    icon: string;
  };
  forecast: {
    date: string;
    icon: string;
    max: number;
    min: number;
    precipitationProbability: number | null;
  }[];
  recommendations: { icon: string; text: string }[];
  fetchedAt: string;
}

// 📸 Fotos
export type GalleryCategory = 'TASK_EVIDENCE' | 'MEMORY';
export interface GalleryPhoto {
  id: string;
  title: string;
  category: GalleryCategory;
  createdAt: string;
  employee: PersonRef | null;
}
export interface PhotosListResponse extends Page {
  photos: GalleryPhoto[];
  photoStorage: 'configured' | 'unconfigured';
}

// ⚙️ Personas y datos del equipo
export type EmployeeRole = 'Doméstica' | 'Parque' | 'Otro';
export interface ManagedEmployee {
  id: string;
  displayName: string;
  role: string;
  colorHex: string;
  active: boolean;
  account: {
    userId: string;
    status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
    hasPin: boolean;
  } | null;
}
export interface EmployeeFormRequest {
  displayName: string;
  role: EmployeeRole;
  colorHex: string;
}
export interface Age {
  years: number;
  months: number;
}
export interface Child {
  id: string;
  name: string;
  birthDate: string | null;
  age: Age | null;
}
export interface PersonalProfile {
  fullLegalName: string | null;
  birthDate: string | null;
  maritalStatus: string | null;
  phone: string | null;
  taxId: string | null;
  healthInsurance: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}
export type TeamFilter = 'all' | 'complete' | 'incomplete';
export interface TeamMember {
  id: string;
  displayName: string;
  role: string;
  colorHex: string;
  complete: boolean;
  profile: PersonalProfile | null;
  children: Child[];
}

// 👤 Mi perfil
export interface MyProfileResponse {
  employee: PersonRef & { role: string };
  profile: PersonalProfile | null;
  children: Child[];
}
