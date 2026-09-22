import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusScreen } from './StatusScreen';

describe('StatusScreen', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:4000/api/v1');
  });

  it('muestra el nombre de la aplicación', () => {
    render(<StatusScreen />);
    expect(screen.getByRole('heading', { name: /la cañada/i })).toBeInTheDocument();
  });

  it('muestra el estado temporal "Frontend operativo"', () => {
    render(<StatusScreen />);
    expect(screen.getByText(/frontend operativo/i)).toBeInTheDocument();
  });

  it('no muestra información del negocio (personas, tareas, stock)', () => {
    render(<StatusScreen />);
    const content = screen.getByRole('main').textContent ?? '';
    expect(content).not.toMatch(/tarea|stock|gallina|mascota/i);
  });
});
