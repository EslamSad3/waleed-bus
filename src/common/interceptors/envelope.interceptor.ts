import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful response in the platform envelope `{ statusCode, data }`.
 * Controllers return plain payloads; errors bypass this interceptor and are
 * shaped by AllExceptionsFilter.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context
      .switchToHttp()
      .getResponse<{ statusCode: number }>();
    return next
      .handle()
      .pipe(map((data) => ({ statusCode: response.statusCode, data })));
  }
}
