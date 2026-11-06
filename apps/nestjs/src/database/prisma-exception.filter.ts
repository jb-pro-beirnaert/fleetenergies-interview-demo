import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

const STATUS_BY_CODE: Record<string, { status: number; message: string }> = {
  // Foreign key: unknown truck, driver or place id
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Unknown reference' },
  P2002: { status: HttpStatus.CONFLICT, message: 'Doublon' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Not found' },
};

// Maps the expected Prisma errors to HTTP responses; the others stay 500s
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const known = STATUS_BY_CODE[exception.code];
    if (!known) {
      response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ statusCode: 500, message: 'Internal server error' });
      return;
    }
    response.status(known.status).json({
      statusCode: known.status,
      message: known.message,
      code: exception.code,
    });
  }
}
