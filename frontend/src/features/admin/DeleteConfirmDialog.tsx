import { ConfirmDialog } from './ConfirmDialog';

interface DeleteConfirmDialogProps {
  /** Qué se elimina, en minúscula y con artículo: "la tarea", "el producto"… */
  entityLabel: string;
  name: string;
  /** Cuándo NO se puede eliminar (y conviene desactivar), en lenguaje humano. */
  keepWhen: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Confirmación de ELIMINACIÓN definitiva, separada de Desactivar: nombra la
 * entidad, avisa que no se puede deshacer y explica cuándo conviene
 * desactivar. Si el backend responde `409 *_IN_USE`, `ConfirmDialog` muestra
 * su mensaje humano ("Desactivala para conservar el historial") sin cerrar el
 * diálogo; un doble clic genera una sola operación.
 */
export function DeleteConfirmDialog({
  entityLabel,
  name,
  keepWhen,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      title={`Eliminar «${name}»`}
      description={
        <>
          Vas a eliminar definitivamente {entityLabel} «{name}».{' '}
          <strong>No se puede deshacer.</strong> Solo es posible si se creó por error y todavía no
          tiene historia. Si {keepWhen}, usá «Desactivar» en su lugar: deja de usarse y conserva
          todo el historial.
        </>
      }
      confirmLabel="Eliminar definitivamente"
      tone="danger"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
