import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { CodedException } from '../filters/coded.exception.js';

function flatten(
  errors: ValidationError[],
  prefix: string,
  out: Record<string, string>,
): void {
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const messages = error.constraints ? Object.values(error.constraints) : [];
    if (messages.length > 0) out[path] = messages.join(', ');
    if (error.children?.length) flatten(error.children, path, out);
  }
}

/**
 * Single ValidationPipe for the app and e2e harness: invalid payloads are
 * 400 VALIDATION_FAILED with per-field details (PRD error catalog), never
 * bare framework errors.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const fields: Record<string, string> = {};
      flatten(errors, '', fields);
      return new CodedException(
        400,
        'VALIDATION_FAILED',
        'The request is invalid.',
        { fields },
      );
    },
  });
}
