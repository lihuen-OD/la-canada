import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// Config compartida del monorepo (raíz). Cubre frontend/ y backend/ con reglas
// distintas por carpeta, y deja afuera todo lo que no debe tocarse en esta
// etapa (index.html original, su copia en legacy/, y los build outputs).
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'legacy/**',
      'index.html',
      'docs/**',
      'backend/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Archivos de configuración ejecutados bajo Node (vite.config.ts, etc.)
    files: ['**/*.config.{js,ts,cjs,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['backend/src/**/*.ts', 'backend/prisma/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  // Debe ir al final: desactiva reglas de estilo de ESLint que compitan con Prettier.
  prettierConfig,
);
