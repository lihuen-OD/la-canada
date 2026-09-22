import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Aserciones estructurales sobre el propio `schema.prisma`, leído como
 * texto — no requieren PostgreSQL ni PrismaClient. Complementan
 * `prisma validate` (que confirma que el schema es sintácticamente válido,
 * pero no que respete las decisiones de diseño de este proyecto).
 */

const SCHEMA_FILE = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf-8');

function modelBlock(modelName: string): string {
  const match = SCHEMA_FILE.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`No se encontró el modelo ${modelName} en schema.prisma`);
  return match[1] ?? '';
}

describe('TaskExecution — asignado vs. completador', () => {
  const block = modelBlock('TaskExecution');

  it('tiene assignedEmployeeId (snapshot obligatorio) y completedByEmployeeId (nullable) como campos separados', () => {
    expect(block).toMatch(/assignedEmployeeId\s+String\s+@map/);
    expect(block).toMatch(/completedByEmployeeId\s+String\?\s+@map/);
  });

  it('assignedEmployeeId y completedByEmployeeId usan relaciones nombradas distintas', () => {
    expect(block).toMatch(/@relation\("TaskExecutionAssignedTo"/);
    expect(block).toMatch(/@relation\("TaskExecutionCompletedBy"/);
  });

  it('assignedEmployeeId está indexado', () => {
    expect(block).toMatch(/@@index\(\[assignedEmployeeId\]\)/);
  });
});

describe('Singletons con clave natural', () => {
  it('PropertyLocation tiene code String @unique', () => {
    const block = modelBlock('PropertyLocation');
    expect(block).toMatch(/code\s+String\s+@unique/);
  });

  it('ChickenCoop tiene code String @unique', () => {
    const block = modelBlock('ChickenCoop');
    expect(block).toMatch(/code\s+String\s+@unique/);
  });
});

describe('FileAsset — relaciones auditadas contra el HTML', () => {
  const block = modelBlock('FileAsset');

  it('soporta relación opcional con Task y con Animal', () => {
    expect(block).toMatch(/taskId\s+String\?/);
    expect(block).toMatch(/animalId\s+String\?/);
  });

  it('NO tiene relación con NewsReport (sin evidencia funcional en el prototipo)', () => {
    expect(block).not.toMatch(/newsReportId/);
    expect(block).not.toMatch(/newsReport\s+NewsReport/);
  });

  it('NewsReport no tiene relación inversa con FileAsset', () => {
    const newsReportBlock = modelBlock('NewsReport');
    expect(newsReportBlock).not.toMatch(/FileAsset/);
  });

  it('soporta categoría, persona etiquetada, usuario/empleado que subió, y eliminación lógica', () => {
    expect(block).toMatch(/category\s+PhotoCategory/);
    expect(block).toMatch(/taggedEmployeeId/);
    expect(block).toMatch(/uploadedByEmployeeId/);
    expect(block).toMatch(/status\s+FileStatus/);
    expect(block).toMatch(/deletedAt/);
  });

  it('soporta proveedor, metadatos (mimeType, tamaño, checksum) y ETag opcional', () => {
    expect(block).toMatch(/provider\s+FileProvider/);
    expect(block).toMatch(/mimeType/);
    expect(block).toMatch(/sizeBytes/);
    expect(block).toMatch(/checksum/);
    expect(block).toMatch(/etag\s+String\?/i);
  });
});

describe('FileAsset — Neon Object Storage (reemplaza Google Drive)', () => {
  const block = modelBlock('FileAsset');

  it('FileProvider solo contiene NEON_OBJECT_STORAGE (Google Drive descartado)', () => {
    const enumMatch = SCHEMA_FILE.match(/enum FileProvider \{([\s\S]*?)\n\}/);
    expect(enumMatch).not.toBeNull();
    const body = enumMatch?.[1] ?? '';
    expect(body).toMatch(/NEON_OBJECT_STORAGE/);
    expect(body).not.toMatch(/GOOGLE_DRIVE/);
  });

  it('identifica el objeto por bucket + objectKey, no por externalId', () => {
    expect(block).toMatch(/bucket\s+String/);
    expect(block).toMatch(/objectKey\s+String\s+@map/);
    expect(block).not.toMatch(/externalId/);
  });

  it('bucket + objectKey tienen una restricción única compuesta', () => {
    expect(block).toMatch(/@@unique\(\[bucket, objectKey\]\)/);
  });

  it('no persiste URL pública ni URL firmada como fuente de verdad', () => {
    expect(block).not.toMatch(/\burl\s+String/i);
    expect(block).not.toMatch(/signedUrl/i);
    expect(block).not.toMatch(/publicUrl/i);
  });

  it('no persiste credenciales del proveedor de almacenamiento', () => {
    expect(block).not.toMatch(/accessKey/i);
    expect(block).not.toMatch(/secretKey/i);
    expect(block).not.toMatch(/credential/i);
  });

  it('FileStatus cubre el ciclo de vida completo (pendiente, disponible, fallo, eliminación pendiente, eliminado)', () => {
    const enumMatch = SCHEMA_FILE.match(/enum FileStatus \{([\s\S]*?)\n\}/);
    expect(enumMatch).not.toBeNull();
    const body = enumMatch?.[1] ?? '';
    expect(body).toMatch(/PENDING_UPLOAD/);
    expect(body).toMatch(/AVAILABLE/);
    expect(body).toMatch(/UPLOAD_FAILED/);
    expect(body).toMatch(/PENDING_DELETION/);
    expect(body).toMatch(/DELETED/);
  });

  it('el default de status es PENDING_UPLOAD, no ACTIVE', () => {
    expect(block).toMatch(/status\s+FileStatus\s+@default\(PENDING_UPLOAD\)/);
  });
});

describe('StockMovement — idempotencia del movimiento de apertura', () => {
  it('tiene un campo reference nullable y único (permite muchos null, uno por valor no-null)', () => {
    const block = modelBlock('StockMovement');
    expect(block).toMatch(/reference\s+String\?\s+@unique/);
  });
});

describe('Sin relación polimórfica insegura fuera de AuditLog', () => {
  // Búsqueda de *declaraciones de campo* reales (línea que empieza con el
  // nombre seguido de espacio y el tipo), no de menciones en comentarios
  // `///` — varios modelos las mencionan legítimamente en prosa al explicar
  // por qué NO usan ese patrón (ver el comentario de FileAsset).
  const modelNames = [...SCHEMA_FILE.matchAll(/^model (\w+) \{/gm)].map((m) => m[1] as string);

  function modelsDeclaringField(fieldName: string): string[] {
    const fieldPattern = new RegExp(`^\\s*${fieldName}\\s+String`, 'm');
    return modelNames.filter((name) => fieldPattern.test(modelBlock(name)));
  }

  it('entityType/entityId (referencia laxa, sin FK real) solo se declaran como campo en AuditLog', () => {
    expect(modelsDeclaringField('entityType')).toEqual(['AuditLog']);
    expect(modelsDeclaringField('entityId')).toEqual(['AuditLog']);
  });

  it('ningún modelo declara un campo attachableType/attachableId (patrón polimórfico genérico)', () => {
    expect(modelsDeclaringField('attachableType')).toEqual([]);
    expect(modelsDeclaringField('attachableId')).toEqual([]);
  });
});

describe('Cantidades — Decimal, nunca Float', () => {
  it('el schema no declara ningún campo Float', () => {
    expect(SCHEMA_FILE).not.toMatch(/\bFloat\b/);
  });

  it('las cantidades de stock y el peso de animales usan Decimal', () => {
    expect(modelBlock('StockItem')).toMatch(/minimumQuantity\s+Decimal/);
    expect(modelBlock('StockItem')).toMatch(/currentQuantity\s+Decimal/);
    expect(modelBlock('StockMovement')).toMatch(/quantity\s+Decimal/);
    expect(modelBlock('AnimalMedicalRecord')).toMatch(/value\s+Decimal\?/);
  });
});

describe('Timestamps e inmutabilidad', () => {
  it('AuditLog y Session solo tienen createdAt (son registros de un hecho puntual, no entidades mutables con updatedAt)', () => {
    expect(modelBlock('AuditLog')).not.toMatch(/updatedAt/);
    expect(modelBlock('Session')).not.toMatch(/updatedAt/);
  });

  it('los modelos de negocio mutables tienen createdAt y updatedAt', () => {
    for (const model of ['Employee', 'Task', 'StockItem', 'StockCategory', 'AnimalType']) {
      const block = modelBlock(model);
      expect(block, `${model} sin createdAt`).toMatch(/createdAt/);
      expect(block, `${model} sin updatedAt`).toMatch(/updatedAt/);
    }
  });
});
