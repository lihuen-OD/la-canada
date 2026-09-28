import { apiRequest } from './httpClient';
import type {
  Child,
  EmployeeFormRequest,
  EventFormRequest,
  EventType,
  EmployeeProfileResponse,
  EventsResponse,
  FamilyMember,
  FamilyMemberRequest,
  GalleryCategory,
  GalleryPhoto,
  GardenPlanVersion,
  GardenVersionsResponse,
  ManagedEmployee,
  MoreSummary,
  MyProfileResponse,
  NewsItem,
  NewsListResponse,
  OwnBirthday,
  PersonalProfile,
  PersonalProfileResponse,
  PhotosListResponse,
  TeamFilter,
  TeamMember,
  WeatherReport,
} from './moreTypes';

/** Todas autenticadas: ningún endpoint de Más es público. `Idempotency-Key` solo como header. */

const auth = { authenticated: true } as const;
const post = <T>(path: string, body: unknown, headers?: Record<string, string>) =>
  apiRequest<T>(path, { method: 'POST', body, headers, ...auth });

export const fetchMoreSummary = () => apiRequest<MoreSummary>('/more/summary', auth);

// 📝 Novedades
export const fetchNews = (page: number, pageSize: number) =>
  apiRequest<NewsListResponse>(`/news?page=${page}&pageSize=${pageSize}`, auth);
export const createNews = (body: { text: string; employeeId?: string }, idempotencyKey: string) =>
  post<{ news: NewsItem }>('/news', body, { 'Idempotency-Key': idempotencyKey });

// 📅 Eventos
export function fetchEvents(params: { type?: EventType; pastPage: number; pastPageSize: number }) {
  const search = new URLSearchParams({
    pastPage: String(params.pastPage),
    pastPageSize: String(params.pastPageSize),
  });
  if (params.type) search.set('type', params.type);
  return apiRequest<EventsResponse>(`/events?${search.toString()}`, auth);
}
export const createEvent = (body: EventFormRequest) => post<unknown>('/events', body);
export const updateEvent = (eventId: string, body: EventFormRequest) =>
  apiRequest<unknown>(`/events/${eventId}`, { method: 'PATCH', body, ...auth });
export const deleteEvent = (eventId: string) => post<unknown>(`/events/${eventId}/delete`, {});

// 🌤️ Clima
export const fetchWeather = () => apiRequest<WeatherReport>('/weather', auth);

// 📸 Fotos
export function fetchPhotos(params: {
  category?: GalleryCategory;
  page: number;
  pageSize: number;
}) {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.category) search.set('category', params.category);
  return apiRequest<PhotosListResponse>(`/photos?${search.toString()}`, auth);
}
/** Imagen servida por el backend (proxy autenticado): nunca una URL del bucket. */
export const fetchPhotoContent = (photoId: string) =>
  apiRequest<Blob>(`/photos/${photoId}/content`, { ...auth, responseType: 'blob' });
export function uploadPhoto(
  file: File,
  metadata: { title: string; category: GalleryCategory; employeeId: string | null },
  idempotencyKey: string,
) {
  const search = new URLSearchParams({ category: metadata.category, title: metadata.title });
  if (metadata.employeeId) search.set('employeeId', metadata.employeeId);
  return apiRequest<{ photo: GalleryPhoto }>(`/photos?${search.toString()}`, {
    method: 'POST',
    rawBody: file,
    contentType: file.type,
    headers: { 'X-File-Name': encodeURIComponent(file.name), 'Idempotency-Key': idempotencyKey },
    ...auth,
  });
}
export const deletePhoto = (photoId: string) => post<unknown>(`/photos/${photoId}/delete`, {});

// 🌳 Jardín
export function fetchGardenPlanVersions(page: number, pageSize: number) {
  return apiRequest<GardenVersionsResponse>(
    `/more/garden/versions?page=${page}&pageSize=${pageSize}`,
    auth,
  );
}
/** Plano servido por el backend (proxy autenticado): nunca una URL del bucket. */
export const fetchGardenPlanContent = (versionId: string) =>
  apiRequest<Blob>(`/more/garden/versions/${versionId}/content`, {
    ...auth,
    responseType: 'blob',
  });
/** Publica una versión nueva (solo ADMIN). El cuerpo es la imagen, sin metadatos. */
export const publishGardenPlanVersion = (file: File, idempotencyKey: string) =>
  apiRequest<{ version: GardenPlanVersion }>('/more/garden/versions', {
    method: 'POST',
    rawBody: file,
    contentType: file.type,
    headers: { 'X-File-Name': encodeURIComponent(file.name), 'Idempotency-Key': idempotencyKey },
    ...auth,
  });

// ⚙️ Personas y datos del equipo (ADMIN)
export const fetchEmployees = () =>
  apiRequest<{ employees: ManagedEmployee[] }>('/employees', auth);
export const createEmployee = (body: EmployeeFormRequest) =>
  post<{ employee: ManagedEmployee }>('/employees', body);
export const updateEmployee = (employeeId: string, body: Partial<EmployeeFormRequest>) =>
  apiRequest<{ employee: ManagedEmployee }>(`/employees/${employeeId}`, {
    method: 'PATCH',
    body,
    ...auth,
  });
export const setEmployeeActive = (employeeId: string, active: boolean) =>
  apiRequest<{ employee: ManagedEmployee }>(`/employees/${employeeId}/status`, {
    method: 'PATCH',
    body: { active },
    ...auth,
  });
export const fetchTeamProfiles = (filter: TeamFilter) =>
  apiRequest<{ team: TeamMember[] }>(`/employees/profiles?filter=${filter}`, auth);

// 👤 Mi perfil
export const fetchMyProfile = () => apiRequest<MyProfileResponse>('/me/profile', auth);
export const saveMyProfile = (body: PersonalProfile) =>
  apiRequest<EmployeeProfileResponse>('/me/profile', { method: 'PUT', body, ...auth });
/** Perfil personal (usuario sin Employee): mismo endpoint, contrato según la sesión. */
export const saveMyOwnBirthday = (body: OwnBirthday) =>
  apiRequest<PersonalProfileResponse>('/me/profile', { method: 'PUT', body, ...auth });
export const addMyChild = (
  body: { name: string; birthDate: string | null },
  idempotencyKey: string,
) => post<{ child: Child }>('/me/children', body, { 'Idempotency-Key': idempotencyKey });
export const removeMyChild = (childId: string) =>
  post<unknown>(`/me/children/${childId}/remove`, {});

// 👨‍👩‍👧‍👦 Mi familia (el propietario sale de la sesión: nunca se envía userId)
export const fetchMyFamily = () => apiRequest<{ family: FamilyMember[] }>('/me/family', auth);
export const createFamilyMember = (body: FamilyMemberRequest, idempotencyKey: string) =>
  post<{ member: FamilyMember }>('/me/family', body, { 'Idempotency-Key': idempotencyKey });
export const updateFamilyMember = (memberId: string, body: Partial<FamilyMemberRequest>) =>
  apiRequest<{ member: FamilyMember }>(`/me/family/${memberId}`, {
    method: 'PATCH',
    body,
    ...auth,
  });
export const setFamilyMemberActive = (memberId: string, active: boolean) =>
  apiRequest<{ member: FamilyMember }>(`/me/family/${memberId}/status`, {
    method: 'PATCH',
    body: { active },
    ...auth,
  });
export const deleteFamilyMember = (memberId: string) =>
  apiRequest<void>(`/me/family/${memberId}`, { method: 'DELETE', ...auth });
