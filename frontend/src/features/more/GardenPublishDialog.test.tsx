import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../../test/render';
import { gardenVersion } from '../../test/fixtures/more';

const { publishGardenPlanVersion } = vi.hoisted(() => ({ publishGardenPlanVersion: vi.fn() }));
vi.mock('../../api/moreApi', () => ({ publishGardenPlanVersion }));

import { GardenPublishDialog } from './GardenPublishDialog';

/**
 * El object URL se simula con URLs ÚNICAS por llamada, como el navegador: si
 * el componente guardara la URL en un `useMemo` y el cleanup del efecto la
 * revocara, el `<img>` seguiría apuntando a una URL revocada y en un entorno
 * que simula la revocación (como el navegador) aparecería el ícono roto.
 */
let created = 0;
const revoked = new Set<string>();
let revokeEffect: ((url: string) => void) | null = null;

function planFile(name = 'plano.jpg'): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], name, {
    type: 'image/jpeg',
  });
}

function renderDialog(
  options: {
    file?: File;
    strict?: boolean;
    onClose?: () => void;
    onSaved?: () => void;
  } = {},
) {
  const props = {
    file: options.file ?? planFile(),
    onClose: options.onClose ?? vi.fn(),
    onSaved: options.onSaved ?? vi.fn(),
    onSessionExpired: vi.fn(),
  };
  const element = <GardenPublishDialog {...props} />;
  const result = render(options.strict ? <StrictMode>{element}</StrictMode> : element);
  return { ...result, props };
}

/** La preview renderizada; falla el test si no está, sin `as` ni null silencioso. */
function preview(): HTMLImageElement {
  const image = screen.queryByRole('img', { name: 'Vista previa del plano elegido' });
  if (!(image instanceof HTMLImageElement)) throw new Error('no hay vista previa renderizada');
  return image;
}

/** Como `preview`, pero permite `null` (para afirmar que NO se renderiza). */
const maybePreview = () => screen.queryByRole('img', { name: 'Vista previa del plano elegido' });
const publishButton = () =>
  within(screen.getByRole('dialog')).getByRole('button', { name: 'Publicar' });
const closeButton = () =>
  within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' });

/** jsdom no decodifica imágenes: el `onLoad` real lo dispara el navegador. */
async function loadPreview(image: HTMLElement): Promise<void> {
  fireEvent.load(image);
  await waitFor(() => expect(publishButton()).toBeEnabled());
}

beforeEach(() => {
  created = 0;
  revoked.clear();
  revokeEffect = null;
  publishGardenPlanVersion.mockReset();
  publishGardenPlanVersion.mockResolvedValue({ version: gardenVersion(2) });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        created += 1;
        return `blob:plano-${created}`;
      }),
      // Una URL revocada queda inutilizable: si el `<img>` la reutiliza, el
      // navegador no la puede cargar (aquí, `fireEvent.error` lo refleja).
      revokeObjectURL: vi.fn((url: string) => {
        revoked.add(url);
        revokeEffect?.(url);
      }),
    }),
  );
});

describe('🌳 Jardín · vista previa del diálogo de publicación', () => {
  it('1. una selección válida muestra la vista previa de inmediato', () => {
    renderDialog();
    const image = preview();
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', 'blob:plano-1');
    // Nunca un `src` vacío ni una URL revocada.
    expect(image.getAttribute('src')).toBeTruthy();
    expect(revoked.has('blob:plano-1')).toBe(false);
  });

  it('2. bajo StrictMode la preview no queda revocada (el defecto reportado)', async () => {
    // Reproduce el fallo original: si el cleanup revoca la URL que el `<img>`
    // sigue usando, el navegador no puede cargarla.
    revokeEffect = (url) => {
      const stale = document.querySelector<HTMLImageElement>(`img[src="${url}"]`);
      if (stale) fireEvent.error(stale);
    };
    renderDialog({ strict: true });
    const image = preview();
    expect(image).toBeInTheDocument();
    // La URL que sigue en el DOM tiene que ser la viva, no la revocada.
    const shown = image.getAttribute('src') as string;
    expect(revoked.has(shown)).toBe(false);
    expect(screen.queryByText(/No pudimos generar la vista previa/)).not.toBeInTheDocument();
    await loadPreview(image);
    expect(publishButton()).toBeEnabled();
  });

  it('3. `onLoad` habilita Publicar (antes, deshabilitado)', async () => {
    renderDialog();
    expect(publishButton()).toBeDisabled();
    await loadPreview(preview());
    expect(publishButton()).toBeEnabled();
  });

  it('4. `onError` oculta la imagen rota, avisa y deshabilita Publicar', () => {
    renderDialog();
    fireEvent.error(preview());
    expect(maybePreview()).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos generar la vista previa. Volvé a seleccionar la imagen.',
    );
    expect(publishButton()).toBeDisabled();
  });

  it('5. cambiar de archivo revoca solo la URL anterior y muestra la nueva', async () => {
    const first = planFile('plano-1.jpg');
    const { rerender } = renderDialog({ file: first });
    await loadPreview(preview());
    const second = planFile('plano-2.jpg');
    rerender(
      <GardenPublishDialog
        file={second}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );
    const image = await waitFor(() => {
      const found = preview();
      expect(found).toHaveAttribute('src', 'blob:plano-2');
      return found;
    });
    expect(revoked.has('blob:plano-1')).toBe(true);
    expect(revoked.has('blob:plano-2')).toBe(false);
    // El nuevo archivo arranca sin preview cargada: Publicar vuelve a bloquearse.
    expect(publishButton()).toBeDisabled();
    await loadPreview(image);
    expect(publishButton()).toBeEnabled();
  });

  it('6. cancelar libera la URL vigente', async () => {
    const onClose = vi.fn();
    // El diálogo real se desmonta cuando `onClose` corre (así lo hace
    // `GardenScreen`): el harness reproduce ese montaje condicional.
    const Harness = () => {
      const [open, setOpen] = useState(true);
      return open ? (
        <GardenPublishDialog
          file={planFile()}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          onSaved={vi.fn()}
          onSessionExpired={vi.fn()}
        />
      ) : null;
    };
    render(<Harness />);
    await loadPreview(preview());
    await userEvent.click(closeButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(revoked.has('blob:plano-1')).toBe(true);
  });

  it('7. desmontar libera la URL vigente', async () => {
    const { unmount } = renderDialog();
    await loadPreview(preview());
    unmount();
    expect(revoked.has('blob:plano-1')).toBe(true);
  });

  it('8. reabrir empieza limpio: sin preview heredada y Publicar bloqueado', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDialog();
    await loadPreview(preview());
    unmount();
    // Montaje nuevo (como cerrar y volver a abrir el diálogo).
    renderDialog();
    expect(publishButton()).toBeDisabled();
    expect(preview()).toHaveAttribute('src', 'blob:plano-2');
    await user.click(publishButton());
    // No se publica nada sin preview cargada: el clic no dispara el POST.
    expect(publishGardenPlanVersion).not.toHaveBeenCalled();
  });

  it('9. doble clic en Publicar genera un solo POST y no sube antes de confirmar', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    publishGardenPlanVersion.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ version: gardenVersion(2) });
      }),
    );
    const onSaved = vi.fn();
    renderDialog({ onSaved });
    await loadPreview(preview());
    const file = preview().closest('form') as HTMLFormElement;
    // Nada se sube hasta pulsar Publicar.
    expect(publishGardenPlanVersion).not.toHaveBeenCalled();
    const button = publishButton();
    await user.click(button);
    await user.click(button);
    await user.click(button);
    expect(publishGardenPlanVersion).toHaveBeenCalledTimes(1);
    expect(publishGardenPlanVersion.mock.calls[0]?.[0]).toBeInstanceOf(File);
    release();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(file).toBeInTheDocument();
  });
});
