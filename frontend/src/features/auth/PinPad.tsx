interface PinPadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  disabled: boolean;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * Teclado numérico puro — no sabe nada del PIN en sí (lo maneja
 * `PinEntryScreen`), solo emite intenciones. Botones grandes (tamaño
 * táctil real) con nombre accesible explícito, no solo el dígito visual.
 */
export function PinPad({ onDigit, onBackspace, onClear, disabled }: PinPadProps) {
  return (
    <div className="pin-pad" role="group" aria-label="Teclado numérico">
      {DIGITS.map((digit) => (
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
      ))}
      <button
        type="button"
        className="pin-pad__key pin-pad__key--action"
        aria-label="Borrar último dígito"
        disabled={disabled}
        onClick={onBackspace}
      >
        ⌫
      </button>
      <button
        type="button"
        className="pin-pad__key pin-pad__key--action"
        aria-label="Limpiar PIN"
        disabled={disabled}
        onClick={onClear}
      >
        Limpiar
      </button>
    </div>
  );
}
