import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MAX_LIST_ITEMS,
  type DriverMessages,
  type FuelBalance,
  type FuelTransactions,
  type PlaceType,
  type SimilarEvents,
  type TankCurve,
  type TruckProfile,
  type VehicleActivity,
} from '@fleet/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { PiiService } from '../pii/pii.service.js';
import { iso, MINUTE_MS, toNum } from '../common/serialize.js';
import {
  computeFuelBalance,
  distanceKm,
  downsample,
  findLevelChanges,
  findRecoveries,
  findStops,
  hourOfDayParis,
  longestStops,
  movingMinutes,
  nearestPlace,
  SIMILAR_DROP_MIN_L,
  type Reading,
} from './calculations.js';

export interface Window {
  from: Date;
  to: Date;
}

const DAY_MS = 24 * 60 * MINUTE_MS;
// An alert is linked to a past drop if their periods overlap within 30 min
const ALERT_MATCH_MARGIN_MS = 30 * MINUTE_MS;

@Injectable()
export class InvestigationDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: PiiService,
  ) {}

  async profile(truckId: string): Promise<TruckProfile> {
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      include: { homeDepot: { select: { name: true } } },
    });
    if (!truck) throw new NotFoundException('Truck not found');
    return {
      plate: truck.plate,
      make: truck.make,
      model: truck.model,
      energy: truck.energy,
      tankCapacityL: truck.tankCapacityL,
      hasReefer: truck.hasReefer,
      baselineLPer100km: toNum(truck.baselineLPer100km),
      idleLPerHour: toNum(truck.idleLPerHour),
      homeDepot: truck.homeDepot.name,
      sensorNotes: truck.sensorNotes,
    };
  }

  async tankCurve(truckId: string, window: Window): Promise<TankCurve> {
    await this.ensureTruck(truckId);
    const readings = await this.readings(truckId, window);
    if (readings.length === 0) throw this.noData();
    const refuels = await this.refuels(truckId, {
      from: new Date(window.from.getTime() - 30 * MINUTE_MS),
      to: new Date(window.to.getTime() + 30 * MINUTE_MS),
    });

    const levels = readings.map((reading) => reading.fuelLevelL);
    const drops = findLevelChanges(readings, 'drop', 0);
    const biggest = drops.reduce<(typeof drops)[number] | null>(
      (best, drop) => (!best || drop.liters > best.liters ? drop : best),
      null,
    );

    return {
      startLevelL: levels[0],
      endLevelL: levels[levels.length - 1],
      minLevelL: Math.min(...levels),
      maxLevelL: Math.max(...levels),
      biggestDrop: biggest && {
        from: iso(biggest.from.at),
        to: iso(biggest.to.at),
        liters: biggest.liters,
        durationMin: Math.round(
          (biggest.to.at.getTime() - biggest.from.at.getTime()) / MINUTE_MS,
        ),
        ignitionOff: biggest.readings.every((reading) => !reading.ignition),
        maxSpeedKmh: Math.max(
          ...biggest.readings.map((reading) => reading.speedKmh),
        ),
      },
      recoveries: findRecoveries(
        readings,
        refuels.map((refuel) => refuel.occurredAt),
      ).slice(0, MAX_LIST_ITEMS),
      samples: downsample(readings, (reading) => reading.fuelLevelL).map(
        (reading) => ({
          at: iso(reading.at),
          levelL: reading.fuelLevelL,
        }),
      ),
    };
  }

  async activity(truckId: string, window: Window): Promise<VehicleActivity> {
    await this.ensureTruck(truckId);
    const readings = await this.readings(truckId, window);
    const places = await this.places();
    return {
      distanceKm: distanceKm(readings),
      movingMinutes: movingMinutes(readings),
      stops: longestStops(findStops(readings)).map((stop) => {
        const place = nearestPlace(stop.from, places);
        return {
          from: iso(stop.from.at),
          to: iso(stop.to.at),
          durationMin: stop.durationMin,
          ignitionOff: stop.ignitionOff,
          place: place && { name: place.name, type: place.type },
          lat: stop.from.lat,
          lon: stop.from.lon,
        };
      }),
    };
  }

  async fuelTransactions(
    truckId: string,
    window: Window,
  ): Promise<FuelTransactions> {
    await this.ensureTruck(truckId);
    const refuels = await this.refuels(truckId, window);
    return {
      refuels: refuels.slice(0, MAX_LIST_ITEMS).map((refuel) => ({
        at: iso(refuel.occurredAt),
        place: refuel.place?.name ?? null,
        liters: toNum(refuel.liters),
        totalEur: toNum(refuel.totalEur),
        source: refuel.source,
        invoiceId: null,
      })),
    };
  }

  async driverMessages(
    truckId: string,
    window: Window,
  ): Promise<DriverMessages> {
    await this.ensureTruck(truckId);
    // The 20 most recent, put back in chronological order
    const messages = await this.prisma.driverMessage.findMany({
      where: { truckId, sentAt: { gte: window.from, lte: window.to } },
      orderBy: { sentAt: 'desc' },
      take: MAX_LIST_ITEMS,
      select: {
        sentAt: true,
        body: true,
        driver: { select: { pseudonym: true } },
      },
    });
    const mask = await this.pii.masker();
    return {
      messages: messages.reverse().map((message) => ({
        sentAt: iso(message.sentAt),
        driver: message.driver.pseudonym,
        body: mask(message.body),
      })),
    };
  }

  async fuelBalance(truckId: string, window: Window): Promise<FuelBalance> {
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
    });
    if (!truck) throw new NotFoundException('Truck not found');
    const readings = await this.readings(truckId, window);
    if (readings.length === 0) throw this.noData();
    const refuels = await this.refuels(truckId, window);
    return computeFuelBalance({
      readings,
      refueledL: refuels.reduce((sum, refuel) => sum + toNum(refuel.liters), 0),
      baselineLPer100km: toNum(truck.baselineLPer100km),
      idleLPerHour: toNum(truck.idleLPerHour),
    });
  }

  /**
   * Drops ≥ 25 L in ≤ 20 min while stopped over the `lookbackDays` days before
   * the truck's latest reading (simulated clock, not the real clock).
   */
  async similarEvents(
    truckId: string,
    lookbackDays: number,
  ): Promise<SimilarEvents> {
    await this.ensureTruck(truckId);
    const last = await this.prisma.telemetryReading.findFirst({
      where: { truckId },
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true },
    });
    if (!last) return { events: [] };

    const window = {
      from: new Date(last.recordedAt.getTime() - lookbackDays * DAY_MS),
      to: last.recordedAt,
    };
    const [readings, places, alerts] = await Promise.all([
      this.readings(truckId, window),
      this.places(),
      this.prisma.alert.findMany({
        where: {
          truckId,
          windowEnd: {
            gte: new Date(window.from.getTime() - ALERT_MATCH_MARGIN_MS),
          },
        },
        select: {
          id: true,
          windowStart: true,
          windowEnd: true,
          investigation: { select: { category: true } },
        },
      }),
    ]);

    const events = findLevelChanges(readings, 'drop', SIMILAR_DROP_MIN_L).map(
      (drop) => {
        const alert = alerts.find(
          (candidate) =>
            candidate.windowStart.getTime() - ALERT_MATCH_MARGIN_MS <=
              drop.to.at.getTime() &&
            candidate.windowEnd.getTime() + ALERT_MATCH_MARGIN_MS >=
              drop.from.at.getTime(),
        );
        return {
          at: iso(drop.from.at),
          dropL: drop.liters,
          hourOfDay: hourOfDayParis(drop.from.at),
          placeType: (nearestPlace(drop.from, places)?.type ??
            null) as PlaceType | null,
          ignitionOff: drop.readings.every((reading) => !reading.ignition),
          alertId: alert?.id ?? null,
          verdictCategory: alert?.investigation?.category ?? null,
        };
      },
    );
    return { events: events.slice(-MAX_LIST_ITEMS) };
  }

  private async ensureTruck(truckId: string) {
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      select: { id: true },
    });
    if (!truck) throw new NotFoundException('Truck not found');
  }

  private noData() {
    return new NotFoundException('No readings over this period');
  }

  private async readings(truckId: string, window: Window): Promise<Reading[]> {
    const rows = await this.prisma.telemetryReading.findMany({
      where: { truckId, recordedAt: { gte: window.from, lte: window.to } },
      orderBy: { recordedAt: 'asc' },
    });
    return rows.map((row) => ({
      at: row.recordedAt,
      lat: row.lat,
      lon: row.lon,
      speedKmh: toNum(row.speedKmh),
      ignition: row.ignition,
      fuelLevelL: toNum(row.fuelLevelL),
      odometerKm: toNum(row.odometerKm),
    }));
  }

  private refuels(truckId: string, window: Window) {
    return this.prisma.refuel.findMany({
      where: { truckId, occurredAt: { gte: window.from, lte: window.to } },
      orderBy: { occurredAt: 'asc' },
      include: { place: { select: { name: true } } },
    });
  }

  private places() {
    return this.prisma.place.findMany({
      select: { name: true, type: true, lat: true, lon: true, radiusM: true },
    });
  }
}
