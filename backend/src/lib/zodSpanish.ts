import { z } from 'zod';

/**
 * Mensajes por defecto de Zod en español claro. Los esquemas que definen su
 * propio mensaje ("Ingresá una fecha válida.") lo conservan: esto solo cubre
 * los casos sin mensaje explícito, que antes salían en inglés ("Invalid
 * input", "Unrecognized key"). Nunca nombra campos internos ni tipos técnicos.
 */
const es = z.locales.es();

export function spanishIssueMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined
        ? 'Falta un dato obligatorio.'
        : 'Revisá los datos ingresados.';
    case 'unrecognized_keys':
      return 'La solicitud incluye datos que no se pueden modificar.';
    case 'invalid_format':
      if (issue.format === 'uuid' || issue.format === 'guid')
        return 'El identificador no es válido.';
      if (issue.format === 'email') return 'Ingresá un correo válido.';
      return 'El formato de un dato no es válido.';
    case 'too_small':
      return issue.origin === 'string'
        ? 'Completá el dato requerido.'
        : 'El valor es demasiado chico.';
    case 'too_big':
      return issue.origin === 'string'
        ? 'El texto es demasiado largo.'
        : 'El valor es demasiado grande.';
    case 'invalid_value':
      return 'Elegí una opción válida.';
    default:
      return 'Revisá los datos ingresados.';
  }
}

let configured = false;

/** Idempotente: `app.ts` lo aplica una vez al arrancar. */
export function configureSpanishValidation(): void {
  if (configured) return;
  configured = true;
  z.config({
    ...es,
    customError: (issue) => spanishIssueMessage(issue as z.core.$ZodRawIssue),
  });
}
