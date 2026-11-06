import type { Prisma } from '../generated/prisma/client.js';

export function toNum(value: Prisma.Decimal): number;
export function toNum(value: Prisma.Decimal | null): number | null;
export function toNum(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

export function iso(value: Date): string;
export function iso(value: Date | null): string | null;
export function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export const round1 = (value: number) => Math.round(value * 10) / 10;

export const MINUTE_MS = 60_000;
