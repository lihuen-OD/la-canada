import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NEUTRAL_AVATAR_COLOR } from '../utils/color';

/**
 * Guardas estructurales de estilos. Vitest corre con `css: false` (jsdom no
 * aplica hojas de estilo), así que estas reglas se verifican leyendo el
 * código fuente — no reemplazan la revisión visual humana en navegador.
 */
const stylesDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(stylesDir, '..');
const frontendDir = path.resolve(srcDir, '..');

const read = (file: string) => readFileSync(file, 'utf8');
const cssFiles = readdirSync(stylesDir).filter((file) => file.endsWith('.css'));

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const RGB_COLOR = /\brgba?\(/;

describe('estilos — tokens y guardas', () => {
  it('ningún color literal fuera de tokens.css: todo pasa por tokens semánticos', () => {
    for (const file of cssFiles.filter((name) => name !== 'tokens.css')) {
      const source = read(path.join(stylesDir, file));
      expect(source, `${file} contiene un color hex literal`).not.toMatch(HEX_COLOR);
      expect(source, `${file} contiene un rgb()/rgba() literal`).not.toMatch(RGB_COLOR);
    }
  });

  it('ningún componente usa colores hex en línea (salvo la validación de colorHex)', () => {
    const allowed = new Set([path.join(srcDir, 'utils', 'color.ts')]);
    for (const file of listSourceFiles(srcDir).filter((name) => !allowed.has(name))) {
      expect(read(file), `${path.relative(srcDir, file)} contiene un color hex`).not.toMatch(
        HEX_COLOR,
      );
    }
  });

  it('la paleta original de docs/UI_CONTEXT.md está definida tal cual', () => {
    const tokens = read(path.join(stylesDir, 'tokens.css'));
    for (const [token, value] of [
      ['--forest-950', '#1a2e1e'],
      ['--forest-700', '#2d5a35'],
      ['--forest-600', '#4a7c59'],
      ['--forest-400', '#7ab587'],
      ['--forest-100', '#e8f2ea'],
      ['--cream-50', '#f7f3ed'],
      ['--cream-100', '#ede7dd'],
      ['--border-warm', '#d8cfc4'],
      ['--ink-950', '#1e1a16'],
      ['--ink-500', '#7a6e62'],
      ['--earth-600', '#8b5e3c'],
      ['--earth-100', '#f2ece5'],
      ['--red-600', '#c0392b'],
      ['--amber-600', '#c89a0a'],
      ['--blue-600', '#2c6e8b'],
    ]) {
      expect(tokens).toContain(`${token}: ${value};`);
    }
    expect(tokens).toContain('--radius-card: 16px;');
    expect(tokens).toContain('--radius-control: 10px;');
    expect(tokens).toContain('--radius-sheet: 22px;');
    expect(tokens).toContain('--tap-target: 44px;');
    expect(tokens).toContain('--sidebar-width: 210px;');
  });

  it('el fallback neutro de avatar coincide con el token --ink-500', () => {
    expect(read(path.join(stylesDir, 'tokens.css'))).toContain(
      `--ink-500: ${NEUTRAL_AVATAR_COLOR};`,
    );
  });

  it('las animaciones respetan prefers-reduced-motion y duran entre 150 y 250ms', () => {
    const base = read(path.join(stylesDir, 'base.css'));
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration/);
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration/);

    const tokens = read(path.join(stylesDir, 'tokens.css'));
    expect(tokens).toContain('--duration-fast: 150ms;');
    expect(tokens).toContain('--duration-slow: 250ms;');
  });

  it('fuentes empaquetadas localmente: ninguna petición a Google Fonts', () => {
    const global = read(path.join(stylesDir, 'global.css'));
    expect(global).toContain("@import '@fontsource/fraunces/");
    expect(global).toContain("@import '@fontsource/karla/");
    for (const source of [
      ...cssFiles.map((file) => read(path.join(stylesDir, file))),
      read(path.join(frontendDir, 'index.html')),
    ]) {
      expect(source).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    }
  });

  it('el viewport no bloquea el zoom del usuario', () => {
    const html = read(path.join(frontendDir, 'index.html'));
    const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale/);
  });
});
