import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { createMasker, type Masker } from './pii.js';

@Injectable()
export class PiiService {
  constructor(private readonly prisma: PrismaService) {}

  // Reloaded on every call: 14 drivers, and a newly added driver is masked immediately
  async masker(): Promise<Masker> {
    const drivers = await this.prisma.driver.findMany({
      select: { fullName: true, pseudonym: true },
    });
    return createMasker(drivers);
  }
}
