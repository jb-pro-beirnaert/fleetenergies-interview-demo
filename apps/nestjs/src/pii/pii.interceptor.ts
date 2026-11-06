import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { mergeMap, type Observable } from 'rxjs';
import { maskDeep } from './pii.js';
import { PiiService } from './pii.service.js';

// Safety net of the /agent/* routes: every string of the response goes through masking
@Injectable()
export class PiiInterceptor implements NestInterceptor {
  constructor(private readonly pii: PiiService) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(
        mergeMap(async (data: unknown) =>
          data === undefined ? data : maskDeep(data, await this.pii.masker()),
        ),
      );
  }
}
