import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { createMasker, type Masker } from './pii.js';

@Injectable()
export class PiiService {
  constructor(private readonly prisma: PrismaService) {}

  // Rechargé à chaque appel : 14 conducteurs, et un conducteur ajouté est masqué immédiatement
  async masker(): Promise<Masker> {
    const drivers = await this.prisma.driver.findMany({
      select: { fullName: true, pseudonym: true },
    });
    return createMasker(drivers);
  }
}
