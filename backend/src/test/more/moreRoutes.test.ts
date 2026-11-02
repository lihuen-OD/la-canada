import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import {
  createNewsBodySchema,
  createNewsReplyBodySchema,
  deleteNewsMessageBodySchema,
  NEWS_REPLY_TEXT_MAX,
  NEWS_TEXT_MAX,
  updateNewsBodySchema,
  updateNewsReplyBodySchema,
} from '../../more/moreSchemas';

const ID = '11111111-1111-4111-8111-111111111111';

describe('☰ Más — ningún endpoint es público', () => {
  it.each([
    ['GET', '/api/v1/more/summary'],
    ['GET', '/api/v1/news'],
    ['POST', '/api/v1/news'],
    ['GET', `/api/v1/news/${ID}/replies`],
    ['POST', `/api/v1/news/${ID}/replies`],
    ['PATCH', `/api/v1/news/${ID}`],
    ['POST', `/api/v1/news/${ID}/delete`],
    ['PATCH', `/api/v1/news/${ID}/replies/${ID}`],
    ['POST', `/api/v1/news/${ID}/replies/${ID}/delete`],
    ['GET', '/api/v1/events'],
    ['POST', '/api/v1/events'],
    ['PATCH', `/api/v1/events/${ID}`],
    ['POST', `/api/v1/events/${ID}/delete`],
    ['GET', '/api/v1/weather'],
    ['GET', '/api/v1/photos'],
    ['POST', '/api/v1/photos'],
    ['GET', `/api/v1/photos/${ID}/content`],
    ['POST', `/api/v1/photos/${ID}/delete`],
    ['POST', `/api/v1/photos/${ID}/move`],
    ['GET', '/api/v1/photos/folders'],
    ['POST', '/api/v1/photos/folders'],
    ['PATCH', `/api/v1/photos/folders/${ID}`],
    ['POST', `/api/v1/photos/folders/${ID}/delete`],
    ['GET', '/api/v1/more/garden/versions'],
    ['POST', '/api/v1/more/garden/versions'],
    ['GET', `/api/v1/more/garden/versions/${ID}/content`],
    ['GET', '/api/v1/employees'],
    ['GET', '/api/v1/employees/profiles'],
    ['POST', '/api/v1/employees'],
    ['PATCH', `/api/v1/employees/${ID}`],
    ['PATCH', `/api/v1/employees/${ID}/status`],
    ['GET', '/api/v1/me/profile'],
    ['PUT', '/api/v1/me/profile'],
    ['POST', '/api/v1/me/children'],
    ['POST', `/api/v1/me/children/${ID}/remove`],
    ['GET', '/api/v1/me/family'],
    ['POST', '/api/v1/me/family'],
    ['PATCH', `/api/v1/me/family/${ID}`],
    ['PATCH', `/api/v1/me/family/${ID}/status`],
    ['DELETE', `/api/v1/me/family/${ID}`],
  ] as const)('%s %s requiere sesión', async (method, path) => {
    const app = createApp();
    const agent = request(app);
    const call =
      method === 'GET'
        ? agent.get(path)
        : method === 'POST'
          ? agent.post(path).send({})
          : method === 'PUT'
            ? agent.put(path).send({})
            : method === 'DELETE'
              ? agent.delete(path)
              : agent.patch(path).send({});
    const response = await call;
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });
});

describe('routers de Más — superficie', () => {
  const source = readFileSync(resolve(__dirname, '../../routes/moreRoutes.ts'), 'utf-8');

  it('cada router exige sesión; Configuración además exige ADMIN', () => {
    for (const name of [
      'moreRouter',
      'newsRouter',
      'eventsRouter',
      'weatherRouter',
      'photosRouter',
      'gardenRouter',
      'meRouter',
    ]) {
      expect(source).toMatch(new RegExp(`${name}\\.use\\(requireAuth\\)`));
    }
    expect(source).toMatch(/employeesRouter\.use\(requireAuth, requireRole\('ADMIN'\)\)/);
  });

  it('las rutas de respuestas quedan detrás de requireAuth y no requieren rol admin', () => {
    expect(source).toMatch(/newsRouter\.use\(requireAuth\)/);
    expect(source).toMatch(/newsRouter\.get\('\/:id\/replies', getNewsRepliesHandler\)/);
    expect(source).toMatch(
      /newsRouter\.post\('\/:id\/replies', requireJsonContentType, postNewsReplyHandler\)/,
    );
    expect(source).not.toMatch(/newsRouter\.(get|post)\('\/:id\/replies', requireRole/);
  });

  it('editar y eliminar mensajes: sesión, cuerpo JSON y permisos decididos en el servicio (sin requireRole)', () => {
    expect(source).toMatch(
      /newsRouter\.patch\('\/:id', requireJsonContentType, patchNewsHandler\)/,
    );
    expect(source).toMatch(
      /newsRouter\.post\('\/:id\/delete', requireJsonContentType, postDeleteNewsHandler\)/,
    );
    expect(source).toMatch(
      /newsRouter\.patch\('\/:id\/replies\/:replyId', requireJsonContentType, patchNewsReplyHandler\)/,
    );
    expect(source).toMatch(
      /newsRouter\.post\(\s*'\/:id\/replies\/:replyId\/delete',\s*requireJsonContentType,\s*postDeleteNewsReplyHandler,?\s*\)/,
    );
    expect(source).not.toMatch(/newsRouter\.[a-z]+\([^;]*requireRole/);
  });

  it('el único DELETE es un familiar propio (Etapa 5F); el único PUT es el formulario de Mi perfil', () => {
    expect([...source.matchAll(/\.delete\(/g)].map((m) => m.index)).toHaveLength(1);
    expect(source).toMatch(/meRouter\.delete\('\/family\/:id', deleteMyFamilyHandler\)/);
    expect([...source.matchAll(/\.put\(/g)]).toHaveLength(1);
    expect(source).toMatch(/meRouter\.put\('\/profile', requireJsonContentType/);
  });

  it('toda mutación exige un guard de cuerpo: JSON, o el parser binario acotado', () => {
    // `.*` hasta el cierre de la línea: los guards pueden traer paréntesis
    // propios (`requireRole('ADMIN')`) y no deben partirse al cortarlos.
    const mutations = [...source.matchAll(/Router\.(post|patch|put)\(([\s\S]*?)\);/g)].map(
      (m) => m[2] ?? '',
    );
    expect(mutations.length).toBeGreaterThanOrEqual(17);
    for (const args of mutations) {
      expect(args).toMatch(/requireJsonContentType|parseGalleryPhotoBody|parseGardenPlanBody/);
    }
  });

  it('el parser binario acotado es solo de imágenes, y publicar el plano exige ADMIN antes', () => {
    expect(source).toMatch(/photosRouter\.post\('\/', parseGalleryPhotoBody/);
    // ADMIN se comprueba ANTES de leer el cuerpo: un EMPLOYEE recibe el 403
    // sin subir 10 MB de imagen.
    expect(source).toMatch(
      /gardenRouter\.post\('\/versions', requireRole\('ADMIN'\), parseGardenPlanBody/,
    );
    expect(source).not.toMatch(/express\.json/);
  });

  it('carpetas y mover: sesión y cuerpo JSON; permisos (creador o ADMIN) en el servicio, sin requireRole', () => {
    expect(source).toMatch(/photosRouter\.get\('\/folders', getPhotoFoldersHandler\)/);
    expect(source).toMatch(
      /photosRouter\.post\('\/folders', requireJsonContentType, postPhotoFolderHandler\)/,
    );
    expect(source).toMatch(
      /photosRouter\.patch\('\/folders\/:id', requireJsonContentType, patchPhotoFolderHandler\)/,
    );
    expect(source).toMatch(
      /photosRouter\.post\('\/folders\/:id\/delete', requireJsonContentType, postDeletePhotoFolderHandler\)/,
    );
    expect(source).toMatch(
      /photosRouter\.post\('\/:id\/move', requireJsonContentType, postMovePhotoHandler\)/,
    );
    expect(source).not.toMatch(/photosRouter\.[a-z]+\([^;]*requireRole/);
    // `/folders` antes que las rutas por id de foto.
    expect(source.indexOf("photosRouter.get('/folders'")).toBeLessThan(
      source.indexOf("photosRouter.get('/:id/content'"),
    );
  });

  it('el Jardín no tiene borrado ni edición: las versiones son inmutables', () => {
    expect(source).not.toMatch(/gardenRouter\.(delete|patch|put)\(/);
  });
});

describe('esquema de respuestas de novedades', () => {
  it('normaliza saltos de línea sin alterar el texto multilínea', () => {
    expect(createNewsReplyBodySchema.parse({ text: '  primera\r\nsegunda\tparte  ' })).toEqual({
      text: 'primera\nsegunda\tparte',
    });
  });

  it.each(['\u0000', '\u0008', '\u000b', '\u007f'])(
    'rechaza el carácter de control %j',
    (controlCharacter) => {
      expect(
        createNewsReplyBodySchema.safeParse({ text: `texto${controlCharacter}inválido` }).success,
      ).toBe(false);
    },
  );

  it('limita el texto a 1000 caracteres', () => {
    expect(
      createNewsReplyBodySchema.safeParse({ text: 'x'.repeat(NEWS_REPLY_TEXT_MAX + 1) }).success,
    ).toBe(false);
  });
});

describe('esquemas de edición y eliminación de mensajes', () => {
  it('editar una novedad usa las validaciones del alta y exige la versión vista', () => {
    expect(updateNewsBodySchema.parse({ text: '  Se cortó   la luz ', version: 3 })).toEqual({
      text: createNewsBodySchema.parse({ text: '  Se cortó   la luz ' }).text,
      version: 3,
    });
    expect(updateNewsBodySchema.safeParse({ text: 'Aviso' }).success).toBe(false);
    expect(updateNewsBodySchema.safeParse({ text: '   ', version: 1 }).success).toBe(false);
    expect(
      updateNewsBodySchema.safeParse({ text: 'x'.repeat(NEWS_TEXT_MAX + 1), version: 1 }).success,
    ).toBe(false);
    expect(updateNewsBodySchema.safeParse({ text: '<b>x</b>', version: 1 }).success).toBe(false);
  });

  it('editar una respuesta conserva saltos de línea y limita a 1000 caracteres', () => {
    expect(updateNewsReplyBodySchema.parse({ text: ' a\r\nb ', version: 1 })).toEqual({
      text: 'a\nb',
      version: 1,
    });
    expect(
      updateNewsReplyBodySchema.safeParse({ text: 'x'.repeat(NEWS_REPLY_TEXT_MAX + 1), version: 1 })
        .success,
    ).toBe(false);
    expect(updateNewsReplyBodySchema.safeParse({ text: ' \n ', version: 1 }).success).toBe(false);
  });

  it.each([
    { text: 'x', version: 1, authorUserId: ID },
    { text: 'x', version: 1, employeeId: ID },
    { text: 'x', version: 0 },
    { text: 'x', version: 1.5 },
    { text: 'x', version: '1' },
  ])('rechaza autor, persona o versión enviados por el cliente: %j', (body) => {
    expect(updateNewsBodySchema.safeParse(body).success).toBe(false);
    expect(updateNewsReplyBodySchema.safeParse(body).success).toBe(false);
  });

  it('eliminar solo recibe la versión', () => {
    expect(deleteNewsMessageBodySchema.parse({ version: 2 })).toEqual({ version: 2 });
    expect(deleteNewsMessageBodySchema.safeParse({}).success).toBe(false);
    expect(deleteNewsMessageBodySchema.safeParse({ version: 2, deletedByUserId: ID }).success).toBe(
      false,
    );
  });
});
