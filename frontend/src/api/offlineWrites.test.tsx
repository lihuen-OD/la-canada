import { useMutation, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './httpClient';
import { OFFLINE_WRITE_MESSAGE } from './errorMessages';
import { classifyError, userMessageForError } from './errorClassification';
import { createAppQueryClient } from './queryClient';
import { OfflineError } from './transportErrors';
import { getBackendAvailability } from '../connectivity/backendAvailability';
import { EventFormDialog } from '../features/more/EventFormDialog';

/**
 * Etapa 5R — una escritura intentada sin Internet falla al instante, de
 * forma visible y recuperable: nunca queda en cola para enviarse sola al
 * reconectar, y no se confunde con una respuesta ambigua (no se envió).
 */
let calls: string[] = [];

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input).replace('/api/v1', '')}`);
      return Promise.resolve(Response.json({ event: { id: 'e1' } }, { status: 201 }));
    }),
  );
});

afterEach(() => {
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('escrituras sin conexión', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s sin Internet: OfflineError inmediato, sin tocar la red',
    async (method) => {
      setOnline(false);
      const error = await apiRequest('/tasks/1', { method, body: {} }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OfflineError);
      expect(calls).toEqual([]);
      expect(classifyError(error)).toBe('offline');
      expect(userMessageForError(error)).toBe(OFFLINE_WRITE_MESSAGE);
    },
  );

  it('al volver la conexión no se envía nada solo; el reintento manual sale una sola vez', async () => {
    setOnline(false);
    await apiRequest('/tasks', { method: 'POST', body: { title: 'x' } }).catch(() => undefined);
    setOnline(true);
    await act(async () => undefined);
    expect(calls).toEqual([]);

    await apiRequest('/tasks', { method: 'POST', body: { title: 'x' } });
    expect(calls).toEqual(['POST /tasks']);
  });

  it('no abre un episodio de "backend dormido": la falta de Internet la informa el navegador', async () => {
    setOnline(false);
    await apiRequest('/tasks', { method: 'POST', body: {} }).catch(() => undefined);
    expect(getBackendAvailability().status).not.toBe('checking');
    expect(calls.filter((c) => c.includes('/health'))).toEqual([]);
  });

  it('una mutación de TanStack Query sin Internet falla al instante en vez de quedar en pausa', async () => {
    setOnline(false);
    const queryClient = createAppQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useMutation({ mutationFn: () => apiRequest('/news', { method: 'POST', body: {} }) }),
      { wrapper },
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(result.current.error).toBeInstanceOf(OfflineError);

    setOnline(true);
    await act(async () => undefined);
    expect(calls).toEqual([]);
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .every((m) => !m.state.isPaused),
    ).toBe(true);
  });

  it('formulario real: sin Internet muestra el error, conserva lo cargado y no envía; al reintentar, un solo envío', async () => {
    const onSaved = vi.fn();
    const queryClient = createAppQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <EventFormDialog onClose={vi.fn()} onSaved={onSaved} onSessionExpired={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Visita sintética' } });
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Nota (opcional)'), {
      target: { value: 'Traer llaves' },
    });

    setOnline(false);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE_WRITE_MESSAGE);
    expect(calls).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Título')).toHaveValue('Visita sintética');
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Nota (opcional)')).toHaveValue('Traer llaves');

    setOnline(true);
    await act(async () => undefined);
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(['POST /events']);
  });
});
