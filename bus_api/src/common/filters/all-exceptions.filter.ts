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
 * Single error response shape: `{ statusCode, message }`, extended with
 * `code` / `details` / `retryAfter` when the thrown HttpException carries
 * them (see CodedException — PRD error catalog for mobile clients).
 * Unknown errors are masked as 500 so internals (stacks, connection strings)
 * never reach the client. Prisma P2025 (record not found) maps to 404 — the
 * standard answer for cross-tenant misses.
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
        typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
      const out: Record<string, unknown> = { statusCode: status, message };
      if (typeof body === 'object' && body !== null) {
        const coded = body as { code?: unknown; details?: unknown; retryAfter?: unknown };
        if (typeof coded.code === 'string') out.code = coded.code;
        if (coded.details !== undefined) out.details = coded.details;
        if (typeof coded.retryAfter === 'number') out.retryAfter = coded.retryAfter;
      }
      response.status(status).json(out);
      return;
    }

    if ((exception as ErrorWithCode)?.code === 'P2025') {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
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
      message: 'Internal server error',
    });
  }
}
