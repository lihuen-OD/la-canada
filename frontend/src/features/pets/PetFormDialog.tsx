import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPet, removePetPhoto, updatePet, uploadPetPhoto } from '../../api/petsApi';
import type { Pet, PetType, PhotoStorageStatus } from '../../api/petTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorMessageOf, isSessionExpired } from './petErrors';
import { PetPhoto } from './PetPhoto';
import { usePetsCache } from './usePetsCache';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

interface PetFormDialogProps {
  /** Sin `pet` = "Nueva mascota". */
  pet?: Pet;
  types: readonly PetType[];
  today: string;
  photoStorage: PhotoStorageStatus;
  onClose: () => void;
  onSaved: (petId: string) => void;
  onSessionExpired: () => void;
}

/**
 * "Nueva mascota" / "Editar mascota" (solo ADMIN, como el prototipo):
 * nombre, tipo, raza, fecha de nacimiento y foto. La foto ya no es una URL
 * externa: se elige un archivo que el backend valida y guarda en el
 * almacenamiento privado. Sin almacenamiento configurado, el resto de la
 * ficha se guarda igual y se avisa que las fotos no están disponibles.
 */
export function PetFormDialog({
  pet,
  types,
  today,
  photoStorage,
  onClose,
  onSaved,
  onSessionExpired,
}: PetFormDialogProps) {
  const formId = useId();
  const { afterPetChange } = usePetsCache();
  const { isSubmitting, run } = useSubmitGuard();
  const selectable = types.filter((type) => type.active || type.id === pet?.type.id);
  const [name, setName] = useState(pet?.name ?? '');
  const [typeId, setTypeId] = useState(pet?.type.id ?? selectable[0]?.id ?? '');
  const [breed, setBreed] = useState(pet?.breed ?? '');
  const [birthDate, setBirthDate] = useState(pet?.birthDate ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photosEnabled = photoStorage === 'configured';
  /** Si el alta ya se guardó y falló solo la foto, reintentar edita esa ficha (nunca otra nueva). */
  const createdIdRef = useRef<string | null>(null);

  function validate(): string | null {
    if (!normalize(name)) return 'Ingresá un nombre.';
    if (!typeId) return 'Elegí el tipo.';
    if (birthDate && birthDate > today) return 'La fecha de nacimiento no puede ser futura.';
    if (file && !PHOTO_TYPES.includes(file.type)) return 'La foto debe ser JPG, PNG o WebP.';
    if (file && file.size > MAX_PHOTO_BYTES) return 'La foto no puede superar 5 MB.';
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    void run(async () => {
      setError(null);
      const body = {
        name: normalize(name),
        animalTypeId: typeId,
        breed: normalize(breed) || null,
        birthDate: birthDate || null,
      };
      const existingId = pet?.id ?? createdIdRef.current;
      let dataSaved = false;
      try {
        const saved = existingId ? await updatePet(existingId, body) : await createPet(body);
        const savedId = saved.pet.id;
        dataSaved = true;
        if (!pet) createdIdRef.current = savedId;
        afterPetChange(savedId);
        if (file) await uploadPetPhoto(savedId, file);
        else if (removePhoto && pet?.photo) await removePetPhoto(savedId);
        afterPetChange(savedId);
        onSaved(savedId);
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        const detail = errorMessageOf(caught);
        setError(dataSaved ? `Los datos se guardaron, pero la foto no: ${detail}` : detail);
      }
    });
  }

  return (
    <Modal titleId={`${formId}-title`} onRequestClose={onClose} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={`${formId}-title`} className="dialog__title">
          {pet ? 'Editar mascota' : 'Nueva mascota'}
        </h2>
        <div className="pet-form__row">
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-name`}>
              Nombre
            </label>
            <input
              id={`${formId}-name`}
              className="field__input"
              maxLength={60}
              autoComplete="off"
              placeholder="Ej: Rex"
              value={name}
              disabled={isSubmitting}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-type`}>
              Tipo
            </label>
            <select
              id={`${formId}-type`}
              className="field__input"
              value={typeId}
              disabled={isSubmitting}
              onChange={(event) => setTypeId(event.target.value)}
            >
              {selectable.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.icon} {type.name}
                  {type.active ? '' : ' (inactivo)'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="pet-form__row">
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-breed`}>
              Raza
            </label>
            <input
              id={`${formId}-breed`}
              className="field__input"
              maxLength={80}
              autoComplete="off"
              placeholder="Ej: Labrador"
              value={breed}
              disabled={isSubmitting}
              onChange={(event) => setBreed(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-birth`}>
              Fecha de nac.
            </label>
            <input
              id={`${formId}-birth`}
              className="field__input"
              type="date"
              max={today}
              value={birthDate}
              disabled={isSubmitting}
              onChange={(event) => setBirthDate(event.target.value)}
            />
          </div>
        </div>

        <fieldset className="pet-form__photo" disabled={isSubmitting || !photosEnabled}>
          <legend className="field__label">Foto (opcional)</legend>
          {pet?.photo && !removePhoto && !file ? (
            <div className="pet-form__current">
              <PetPhoto pet={pet} size="md" />
              <Button size="sm" variant="ghost" onClick={() => setRemovePhoto(true)}>
                Quitar foto
              </Button>
            </div>
          ) : null}
          <input
            id={`${formId}-photo`}
            className="field__input"
            type="file"
            accept={PHOTO_TYPES.join(',')}
            aria-label="Elegir foto"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setRemovePhoto(false);
            }}
          />
          <p className="field__hint">
            {photosEnabled
              ? 'JPG, PNG o WebP de hasta 5 MB.'
              : 'Las fotos no están disponibles: falta configurar el almacenamiento. El resto de la ficha se guarda igual.'}
          </p>
          {removePhoto ? (
            <p className="field__hint">La foto actual se quitará al guardar.</p>
          ) : null}
        </fieldset>

        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Guardando…</span> : null}
          {error ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {error}
            </span>
          ) : null}
        </div>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
