import { HttpException } from '@nestjs/common';

/**
 * HTTP error carrying a stable machine-readable `code` (PRD error catalog)
 * plus optional `details` and `retryAfter` (seconds, on 429s).
 * The global filter renders these alongside `statusCode`/`message` —
 * the success envelope is untouched.
 */
export class CodedException extends HttpException {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
    retryAfter?: number,
  ) {
    super({ code, message, details, retryAfter }, statusCode);
  }
}
