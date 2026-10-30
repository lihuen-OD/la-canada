import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../../test/render';

const { uploadPhoto, fetchPhotoFolders } = vi.hoisted(() => ({
  uploadPhoto: vi.fn(),
  fetchPhotoFolders: vi.fn(),
}));
const { fetchTaskEmployees } = vi.hoisted(() => ({ fetchTaskEmployees: vi.fn() }));
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../api/moreApi', () => ({ uploadPhoto, fetchPhotoFolders }));
vi.mock('../../api/tasksApi', () => ({ fetchTaskEmployees }));
vi.mock('../../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { ApiError } from '../../api/httpClient';
import { photoFolder, photoFoldersResponse } from '../../test/fixtures/more';
import { PhotoUploadDialog } from './PhotoUploadDialog';

/**
 * El mismo defecto que en el plano del jardín: el object URL se creaba en un
 * `useMemo` y lo revocaba el cleanup del efecto, de modo que en `StrictMode`
 * el `<img>` quedaba en una URL muerta (ícono roto) y "Guardar" se habilitaba
 * sin haber visto la foto. Se simula con URLs ÚNICAS por llamada, como el
 * navegador: una URL revocada no se puede cargar.
 */
let created = 0;
const revoked = new Set<string>();
let revokeEffect: ((url: string) => void) | null = null;

function photoFile(name = 'foto.jpg', type = 'image/jpeg', bytes = 6): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10].slice(0, bytes))], name, {
    type,
  });
}

function renderDialog(
  options: {
    file?: File;
    strict?: boolean;
    onClose?: () => void;
    onSaved?: () => void;
    defaultFolderId?: string | null;
  } = {},
) {
  const props = {
    file: options.file ?? photoFile(),
    defaultFolderId: options.defaultFolderId ?? null,
    onClose: options.onClose ?? vi.fn(),
    onSaved: options.onSaved ?? vi.fn(),
    onSessionExpired: vi.fn(),
  };
  const element = <PhotoUploadDialog {...props} />;
  const result = render(options.strict ? <StrictMode>{element}</StrictMode> : element);
  return { ...result, props };
}

/** La preview renderizada; falla el test si no está, sin `as` ni null silencioso. */
function preview(): HTMLImageElement {
  const image = screen.queryByRole('img', { name: 'Vista previa de la foto elegida' });
  if (!(image instanceof HTMLImageElement)) throw new Error('no hay vista previa renderizada');
  return image;
}

/** Como `preview`, pero permite `null` (para afirmar que NO se renderiza). */
const maybePreview = () => screen.queryByRole('img', { name: 'Vista previa de la foto elegida' });
const saveButton = () =>
  within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' });
const cancelButton = () =>
  within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' });

/** jsdom no decodifica imágenes: el `onLoad` real lo dispara el navegador. */
async function loadPreview(image: HTMLElement): Promise<void> {
  fireEvent.load(image);
  await waitFor(() => expect(saveButton()).toBeEnabled());
}

beforeEach(() => {
  created = 0;
  revoked.clear();
  revokeEffect = null;
  uploadPhoto.mockReset();
  uploadPhoto.mockResolvedValue({ photo: { id: 'photo-1' } });
  fetchPhotoFolders.mockReset();
  fetchPhotoFolders.mockResolvedValue(
    photoFoldersResponse([photoFolder('folder-a', 'Jardín'), photoFolder('folder-b', 'Visitas')]),
  );
  fetchTaskEmployees.mockReset();
  fetchTaskEmployees.mockResolvedValue({ employees: [] });
  useAuthMock.mockReturnValue({
    user: { id: 'u1', role: 'ADMIN' },
    hasRole: () => true,
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        created += 1;
        return `blob:foto-${created}`;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revoked.add(url);
        revokeEffect?.(url);
      }),
    }),
  );
});

describe('📸 Fotos · vista previa del diálogo de subida', () => {
  it('1. una selección válida muestra la vista previa de inmediato', () => {
    renderDialog();
    const image = preview();
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', 'blob:foto-1');
    // Nunca un `src` vacío ni una URL revocada.
    expect(image.getAttribute('src')).toBeTruthy();
    expect(revoked.has('blob:foto-1')).toBe(false);
  });

  it('2. bajo StrictMode la preview no queda revocada (el defecto reportado)', async () => {
    revokeEffect = (url) => {
      const stale = document.querySelector<HTMLImageElement>(`img[src="${url}"]`);
      if (stale) fireEvent.error(stale);
    };
    renderDialog({ strict: true });
    const image = preview();
    const shown = image.getAttribute('src') as string;
    expect(revoked.has(shown)).toBe(false);
    expect(screen.queryByText(/No pudimos generar la vista previa/)).not.toBeInTheDocument();
    await loadPreview(image);
    expect(saveButton()).toBeEnabled();
  });

  it('3. `onLoad` habilita Guardar (antes, deshabilitado)', async () => {
    renderDialog();
    expect(saveButton()).toBeDisabled();
    await loadPreview(preview());
    expect(saveButton()).toBeEnabled();
  });

  it('4. `onError` oculta la imagen rota, avisa y deshabilita Guardar', () => {
    renderDialog();
    fireEvent.error(preview());
    expect(maybePreview()).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos generar la vista previa. Volvé a seleccionar la foto.',
    );
    expect(saveButton()).toBeDisabled();
  });

  it('5. cambiar de foto revoca solo la URL anterior y muestra la nueva', async () => {
    const { rerender } = renderDialog({ file: photoFile('foto-1.jpg') });
    await loadPreview(preview());
    rerender(
      <PhotoUploadDialog
        file={photoFile('foto-2.jpg')}
        defaultFolderId={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );
    const image = await waitFor(() => {
      const found = preview();
      expect(found).toHaveAttribute('src', 'blob:foto-2');
      return found;
    });
    expect(revoked.has('blob:foto-1')).toBe(true);
    expect(revoked.has('blob:foto-2')).toBe(false);
    // La foto nueva arranca sin preview cargada: Guardar vuelve a bloquearse.
    expect(saveButton()).toBeDisabled();
    await loadPreview(image);
    expect(saveButton()).toBeEnabled();
  });

  it('6. cancelar libera la URL vigente', async () => {
    const onClose = vi.fn();
    // El diálogo real se desmonta cuando `onClose` corre (como hace
    // `PhotosScreen`): el harness reproduce ese montaje condicional.
    const Harness = () => {
      const [open, setOpen] = useState(true);
      return open ? (
        <PhotoUploadDialog
          file={photoFile()}
          defaultFolderId={null}
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
    await userEvent.click(cancelButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(revoked.has('blob:foto-1')).toBe(true);
  });

  it('7. desmontar libera la URL vigente', async () => {
    const { unmount } = renderDialog();
    await loadPreview(preview());
    unmount();
    expect(revoked.has('blob:foto-1')).toBe(true);
  });

  it('8. reabrir empieza limpio: sin preview heredada y Guardar bloqueado', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDialog();
    await loadPreview(preview());
    unmount();
    // Montaje nuevo (como cerrar y volver a abrir el diálogo).
    renderDialog();
    expect(saveButton()).toBeDisabled();
    expect(preview()).toHaveAttribute('src', 'blob:foto-2');
    await user.click(saveButton());
    // No se sube nada sin haber visto la foto: el clic no dispara el POST.
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('9. doble clic en Guardar sube una sola vez y no sube antes de confirmar', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    uploadPhoto.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ photo: { id: 'photo-1' } });
      }),
    );
    const onSaved = vi.fn();
    renderDialog({ onSaved });
    await loadPreview(preview());
    const form = preview().closest('form') as HTMLFormElement;
    expect(uploadPhoto).not.toHaveBeenCalled();
    await user.click(saveButton());
    await user.click(saveButton());
    await user.click(saveButton());
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(uploadPhoto.mock.calls[0]?.[0]).toBeInstanceOf(File);
    release();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(form).toBeInTheDocument();
  });

  it('10. un archivo inválido por tipo no muestra preview ni habilita Guardar', () => {
    renderDialog({ file: photoFile('nota.txt', 'text/plain') });
    expect(maybePreview()).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('La foto debe ser JPG, PNG o WebP.');
    expect(saveButton()).toBeDisabled();
  });
});

describe('📸 Fotos · carpeta de la subida', () => {
  const folderSelect = () => within(screen.getByRole('dialog')).getByLabelText('Carpeta');

  it('desde una carpeta queda preseleccionada y viaja con la subida', async () => {
    const user = userEvent.setup();
    renderDialog({ defaultFolderId: 'folder-b' });
    await waitFor(() => expect(folderSelect()).toHaveValue('folder-b'));
    await loadPreview(preview());
    await user.click(saveButton());
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    expect(uploadPhoto.mock.calls[0]?.[1]).toMatchObject({ folderId: 'folder-b' });
  });

  it('desde la galería general: «Sin carpeta» por defecto y se puede elegir otra', async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() =>
      expect(within(folderSelect()).getByRole('option', { name: 'Jardín' })).toBeInTheDocument(),
    );
    expect(folderSelect()).toHaveValue('');
    expect(
      within(folderSelect())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Sin carpeta', 'Jardín', 'Visitas']);
    await user.selectOptions(folderSelect(), 'folder-a');
    await loadPreview(preview());
    await user.click(saveButton());
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    expect(uploadPhoto.mock.calls[0]?.[1]).toMatchObject({ folderId: 'folder-a' });
  });

  it('si la carpeta deja de existir: avisa, conserva el formulario y exige elegir otra (sin destino silencioso)', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    uploadPhoto.mockRejectedValueOnce(
      new ApiError(
        409,
        'La carpeta elegida ya no existe. Elegí otra carpeta o «Sin carpeta».',
        'PHOTO_FOLDER_UNAVAILABLE',
      ),
    );
    renderDialog({ defaultFolderId: 'folder-b', onSaved });
    const dialog = within(screen.getByRole('dialog'));
    await waitFor(() => expect(folderSelect()).toHaveValue('folder-b'));
    await user.type(dialog.getByLabelText('Título'), 'Rosas');
    await loadPreview(preview());
    // El listado se actualiza sin «Visitas» (otra persona la eliminó).
    fetchPhotoFolders.mockResolvedValue(photoFoldersResponse([photoFolder('folder-a', 'Jardín')]));
    await user.click(saveButton());
    expect(await dialog.findByRole('alert')).toHaveTextContent(/ya no existe/);
    await waitFor(() => expect(fetchPhotoFolders).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(dialog.getByRole('option', { name: /Ya no existe/ })).toBeInTheDocument(),
    );
    expect(dialog.getByLabelText('Título')).toHaveValue('Rosas');
    expect(saveButton()).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();

    await user.selectOptions(folderSelect(), '');
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(2));
    expect(uploadPhoto.mock.calls[1]?.[1]).toMatchObject({ folderId: null, title: 'Rosas' });
    // Otra intención (otro destino): otra clave de idempotencia.
    expect(uploadPhoto.mock.calls[1]?.[2]).not.toBe(uploadPhoto.mock.calls[0]?.[2]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
