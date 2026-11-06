import { Global, Module } from '@nestjs/common';
import { PiiInterceptor } from './pii.interceptor.js';
import { PiiService } from './pii.service.js';

@Global()
@Module({
  providers: [PiiService, PiiInterceptor],
  exports: [PiiService, PiiInterceptor],
})
export class PiiModule {}
