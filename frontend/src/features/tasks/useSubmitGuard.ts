import { useCallback, useRef, useState } from 'react';

/**
 * Guarda síncrona contra doble envío (mismo patrón que PinDialog/
 * ConfirmDialog): el flag vive en un ref, así dos clicks en el mismo tick
 * no alcanzan a disparar dos requests aunque el `disabled` todavía no se
 * haya pintado.
 */
export function useSubmitGuard() {
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const run = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await operation();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, run };
}
