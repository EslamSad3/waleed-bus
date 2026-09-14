import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

interface ErrorWithCode {
  code?: string;
}

interface JsonResponseType {
  status: (code: number) => { json: (body: unknown) => void };
}

/**
 * Single error response shape: `{ statusCode, code, message, details? }`
 * (PRD §26 catalog for mobile clients — see CodedException), extended with
 * `retryAfter` on 429s. Plain framework exceptions (thrown without a code by
 * guards/pipes) receive a stable default code per status so clients can rely
 * on `code` always being present. Unknown errors are masked as 500 so
 * internals (stacks, connection strings) never reach the client. Prisma
 * P2025 (record not found) maps to 404 — the standard answer for
 * cross-tenant misses.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponseType>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: unknown }).message ?? exception.message);
      const out: Record<string, unknown> = { statusCode: status, message };
      if (typeof body === 'object' && body !== null) {
        const coded = body as {
          code?: unknown;
          details?: unknown;
          retryAfter?: unknown;
        };
        if (typeof coded.code === 'string') out.code = coded.code;
        if (coded.details !== undefined) out.details = coded.details;
        if (typeof coded.retryAfter === 'number')
          out.retryAfter = coded.retryAfter;
      }
      if (typeof out.code !== 'string') out.code = defaultCodeFor(status);
      response.status(status).json(out);
      return;
    }

    if ((exception as ErrorWithCode)?.code === 'P2025') {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Resource not found',
      });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
      'Unhandled exception',
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }
}

/** Stable fallback codes for framework exceptions thrown without a PRD code. */
function defaultCodeFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'AUTHENTICATION_FAILED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_FAILED';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}
