import { describe, expect, it } from 'vitest';
import { animalTypeSeeds } from '../../../prisma/seed-data/animalTypes';
import { BUILTIN_PET_TYPE_NAMES, PET_TYPE_ICON_OPTIONS } from '../../pets/petCatalog';
import { computePetAge, daysToNextBirthday } from '../../pets/petDates';
import { detectImageMime, sanitizeFilename } from '../../pets/petPhotoService';

const d = (text: string) => {
  const [year, month, day] = text.split('-').map(Number) as [number, number, number];
  return { year, month, day };
};

describe('catálogos del prototipo', () => {
  it('los 9 tipos precargados son exactamente los que siembra el seed', () => {
    expect([...BUILTIN_PET_TYPE_NAMES].sort()).toEqual(animalTypeSeeds.map((t) => t.name).sort());
  });
  it('el selector de símbolo tiene las 25 opciones de ANIMAL_EMOJIS, sin repetidos', () => {
    expect(PET_TYPE_ICON_OPTIONS).toHaveLength(25);
    expect(new Set(PET_TYPE_ICON_OPTIONS.map((o) => o.icon)).size).toBe(25);
    for (const seed of animalTypeSeeds) {
      expect(PET_TYPE_ICON_OPTIONS.map((o) => o.icon)).toContain(seed.icon);
    }
  });
});

describe('edad y próximo cumpleaños (calcEdad / calcProxCumple)', () => {
  it('años cumplidos; menos de un año se expresa en meses ajustados por día', () => {
    expect(computePetAge(d('2020-09-26'), d('2026-09-25'))).toEqual({ years: 5, months: 71 });
    expect(computePetAge(d('2020-09-25'), d('2026-09-25'))).toEqual({ years: 6, months: 72 });
    expect(computePetAge(d('2026-07-30'), d('2026-09-25'))).toEqual({ years: 0, months: 1 });
    expect(computePetAge(d('2026-09-25'), d('2026-09-25'))).toEqual({ years: 0, months: 0 });
    expect(computePetAge(d('2026-09-26'), d('2026-09-25'))).toBeNull();
  });
  it('0 = hoy; pasado el día de este año, cuenta hasta el del año siguiente', () => {
    expect(daysToNextBirthday(d('2019-09-25'), d('2026-09-25'))).toBe(0);
    expect(daysToNextBirthday(d('2019-09-30'), d('2026-09-25'))).toBe(5);
    expect(daysToNextBirthday(d('2019-09-24'), d('2026-09-25'))).toBe(364);
  });
  it('29/02 se festeja el 01/03 en años no bisiestos', () => {
    expect(daysToNextBirthday(d('2024-02-29'), d('2027-02-27'))).toBe(2);
    expect(daysToNextBirthday(d('2024-02-29'), d('2028-02-27'))).toBe(2);
  });
});

describe('fotos — tipo real por bytes y nombre saneado', () => {
  it('detecta JPEG, PNG y WebP por su firma; rechaza el resto', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(detectImageMime(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe(
      'image/webp',
    );
    expect(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageMime(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
  });
  it('sin rutas ni caracteres de control; nunca vacío', () => {
    expect(sanitizeFilename('..%2F..%2Fetc%2Fpasswd', 'x.jpg')).toBe('passwd');
    expect(sanitizeFilename('C:\\fotos\\<rex>.jpg', 'x.jpg')).toBe('rex.jpg');
    expect(sanitizeFilename(undefined, 'foto.png')).toBe('foto.png');
    expect(sanitizeFilename('a'.repeat(300), 'x')).toHaveLength(120);
  });
});
