import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '../test/render';
import { describe, expect, it, vi } from 'vitest';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { ProtectedRoute } from './ProtectedRoute';

function renderAt(status: 'anonymous' | 'authenticated') {
  useAuthMock.mockReturnValue({ status });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/login" element={<div>pantalla de login</div>} />
        <Route path="/" element={<ProtectedRoute />}>
          <Route index element={<div>contenido protegido</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('usuario anónimo: nunca renderiza el contenido protegido, redirige al login', () => {
    renderAt('anonymous');
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument();
    expect(screen.getByText('pantalla de login')).toBeInTheDocument();
  });

  it('usuario autenticado: renderiza el contenido protegido', () => {
    renderAt('authenticated');
    expect(screen.getByText('contenido protegido')).toBeInTheDocument();
  });
});
