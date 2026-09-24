import { BackspaceIcon } from '../../components/ui/icons';

interface PinPadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled: boolean;
}

const DIGITS_TOP = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Teclado numérico puro — no sabe nada del PIN en sí (lo maneja
 * `PinEntryScreen`), solo emite intenciones. Cuadrícula de 3 columnas
 * (1–9, y abajo "Limpiar · 0 · Borrar"), teclas de 68px con nombre
 * accesible explícito, no solo el dígito visual. El feedback al presionar
 * es idéntico para todas las teclas.
 */
export function PinPad({ onDigit, onBackspace, onClear, disabled }: PinPadProps) {
  function renderDigit(digit: string) {
    return (
      <button
        key={digit}
        type="button"
        className="pin-pad__key"
        aria-label={`Dígito ${digit}`}
        disabled={disabled}
        onClick={() => onDigit(digit)}
      >
        {digit}
      </button>
    );
  }

  return (
    <div className="pin-pad" role="group" aria-label="Teclado numérico">
      {DIGITS_TOP.map(renderDigit)}
      <button
        type="button"
        className="pin-pad__key pin-pad__key--action"
        aria-label="Limpiar PIN"
        disabled={disabled}
        onClick={onClear}
      >
        Limpiar
      </button>
      {renderDigit('0')}
      <button
        type="button"
        className="pin-pad__key pin-pad__key--action"
        aria-label="Borrar último dígito"
        disabled={disabled}
        onClick={onBackspace}
      >
        <BackspaceIcon size="lg" />
      </button>
    </div>
  );
}
