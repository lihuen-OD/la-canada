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
  garden: { versions: number };
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
/** Origen explícito (Etapa 5F): nunca se deduce del título. */
export type BirthdayOrigin =
  'USER_PROFILE' | 'USER_FAMILY' | 'EMPLOYEE' | 'EMPLOYEE_CHILD' | 'ANIMAL' | 'GLOBAL_RECURRING';
/** A dónde puede ir QUIEN MIRA para corregir un cumpleaños derivado (null = a ningún lado). */
export type BirthdaySourceRef =
  { kind: 'MY_PROFILE' } | { kind: 'TEAM_PROFILES' } | { kind: 'PET'; id: string } | null;
export interface CalendarEvent {
  kind: 'event';
  origin: 'MANUAL';
  id: string;
  title: string;
  date: string;
  type: EventType;
  note: string | null;
  daysUntil: number;
}
export interface BirthdayEvent {
  kind: 'birthday';
  origin: BirthdayOrigin;
  id: string;
  title: string;
  date: string;
  type: 'BIRTHDAY';
  note: string;
  daysUntil: number;
  sourceRef: BirthdaySourceRef;
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

// 🌳 Jardín (Etapa 5Y)
/**
 * Una versión publicada del plano. No hay `fileAssetId`, `objectKey` ni
 * checksum: el cliente pide la imagen por `id` al backend y nunca conoce el
 * bucket. `versionNumber` es el orden real del historial.
 */
export interface GardenPlanVersion {
  id: string;
  versionNumber: number;
  createdAt: string;
  sizeBytes: number;
  mimeType: string;
  publishedBy: string;
}
export interface GardenVersionsResponse extends Page {
  /** La vigente (la de número más alto) o `null` si todavía no hay ninguna. */
  current: GardenPlanVersion | null;
  versions: GardenPlanVersion[];
  gardenStorage: 'configured' | 'unconfigured';
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

// 👤 Mi perfil — ficha de equipo (EMPLOYEE) o perfil personal (usuario sin Employee, p. ej. ADMIN)
export interface EmployeeProfileResponse {
  kind: 'employee';
  employee: PersonRef & { role: string };
  profile: PersonalProfile | null;
  children: Child[];
}
export interface OwnBirthday {
  displayName: string | null;
  birthDate: string | null;
}
export interface PersonalProfileResponse {
  kind: 'personal';
  profile: OwnBirthday;
}
export type MyProfileResponse = EmployeeProfileResponse | PersonalProfileResponse;

// 👨‍👩‍👧‍👦 Mi familia
export type FamilyRelation = 'PARTNER' | 'CHILD' | 'FAMILY' | 'OTHER';
export interface FamilyMember {
  id: string;
  name: string;
  relation: FamilyRelation;
  /** `YYYY-MM-DD`, o `--MM-DD` si no se conoce el año (nunca uno inventado). */
  birthDate: string;
  active: boolean;
  age: Age | null;
  /** De los datos originales: se desactiva, no se elimina. */
  seeded: boolean;
}
export interface FamilyMemberRequest {
  name: string;
  relation: FamilyRelation;
  birthDate: string;
}
