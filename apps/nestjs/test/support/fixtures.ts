import type { TelemetryReading } from '@fleet/contracts';
import type { PrismaService } from '../../src/database/prisma.service.js';

// Identifiants stables, comme ceux du simulateur
export const IDS = {
  carrier: '00000000-0000-4000-8000-000000000001',
  depot: '00000000-0000-4000-8000-000000000101',
  restArea: '00000000-0000-4000-8000-000000000102',
  workshop: '00000000-0000-4000-8000-000000000103',
  station: '00000000-0000-4000-8000-000000000104',
  truck: '00000000-0000-4000-8000-000000000201',
  otherTruck: '00000000-0000-4000-8000-000000000202',
  driver: '00000000-0000-4000-8000-000000000301',
  otherDriver: '00000000-0000-4000-8000-000000000302',
  unknown: '00000000-0000-4000-8000-00000000ffff',
} as const;

export const PLACES = {
  restArea: { lat: 45.2862, lon: 4.8121 },
  workshop: { lat: 44.9334, lon: 4.8924 },
  station: { lat: 44.9012, lon: 4.8807 },
  depot: { lat: 43.9493, lon: 4.8055 },
};

export const DRIVERS = [
  {
    id: IDS.driver,
    carrierId: IDS.carrier,
    fullName: 'Hélène Garnier',
    phone: '06 11 22 33 44',
    pseudonym: 'C-01',
  },
  {
    id: IDS.otherDriver,
    carrierId: IDS.carrier,
    fullName: 'Bruno Lacombe',
    phone: '+33 7 55 66 77 88',
    pseudonym: 'C-02',
  },
];

export const REFERENCE = {
  carriers: [{ id: IDS.carrier, name: 'Transports Durance' }],
  places: [
    {
      id: IDS.depot,
      name: 'Dépôt Avignon',
      type: 'depot' as const,
      ...PLACES.depot,
      radiusM: 300,
    },
    {
      id: IDS.restArea,
      name: "Aire de Saint-Rambert-d'Albon",
      type: 'rest_area' as const,
      ...PLACES.restArea,
    },
    {
      id: IDS.workshop,
      name: 'Atelier PL Valence',
      type: 'workshop' as const,
      ...PLACES.workshop,
    },
    {
      id: IDS.station,
      name: 'AS24 Valence Sud',
      type: 'fuel_station' as const,
      brand: 'AS24',
      ...PLACES.station,
    },
  ],
  trucks: [
    {
      id: IDS.truck,
      carrierId: IDS.carrier,
      plate: 'AB-123-CD',
      make: 'Renault',
      model: 'T 480',
      energy: 'diesel' as const,
      tankCapacityL: 600,
      hasReefer: false,
      baselineLPer100km: 30,
      idleLPerHour: 3,
      homeDepotId: IDS.depot,
      sensorNotes: null,
    },
    {
      id: IDS.otherTruck,
      carrierId: IDS.carrier,
      plate: 'EF-456-GH',
      make: 'Volvo',
      model: 'FH',
      energy: 'hvo' as const,
      tankCapacityL: 700,
      hasReefer: true,
      baselineLPer100km: 32,
      idleLPerHour: 3.5,
      homeDepotId: IDS.depot,
      sensorNotes: 'Sonde remplacée le 02/09, valeurs erratiques signalées',
    },
  ],
  drivers: DRIVERS,
};

export async function seedReference(prisma: PrismaService) {
  await prisma.carrier.createMany({ data: REFERENCE.carriers });
  await prisma.place.createMany({ data: REFERENCE.places });
  await prisma.truck.createMany({ data: REFERENCE.trucks });
  await prisma.driver.createMany({ data: REFERENCE.drivers });
}

export const DEMO_DAY = Date.parse('2026-10-14T00:00:00Z');

export interface ReadingSpec {
  minute: number;
  level: number;
  speed?: number;
  ignition?: boolean;
  odometer?: number;
  lat?: number;
  lon?: number;
}

/** Relevés d'un camion, en minutes depuis `start`. Par défaut : à l'arrêt, moteur coupé, sur l'aire. */
export function readings(
  specs: ReadingSpec[],
  {
    truckId = IDS.truck,
    start = DEMO_DAY,
  }: { truckId?: string; start?: number } = {},
): TelemetryReading[] {
  return specs.map((spec) => ({
    truckId,
    recordedAt: new Date(start + spec.minute * 60_000).toISOString(),
    lat: spec.lat ?? PLACES.restArea.lat,
    lon: spec.lon ?? PLACES.restArea.lon,
    speedKmh: spec.speed ?? 0,
    ignition: spec.ignition ?? false,
    fuelLevelL: spec.level,
    odometerKm: spec.odometer ?? 120_000,
  }));
}

export const minutesAfter = (minute: number, start = DEMO_DAY) =>
  new Date(start + minute * 60_000);

/** Alerte `detected` + tâche d'enquête disponible, sans passer par le détecteur. */
export async function createAlertWithTask(
  prisma: PrismaService,
  {
    availableAt = new Date(Date.now() - 1000),
    truckId = IDS.truck as string,
  } = {},
) {
  const alert = await prisma.alert.create({
    data: {
      truckId,
      type: 'fuel_drop',
      windowStart: minutesAfter(150),
      windowEnd: minutesAfter(162),
      dropL: 180,
      details: { levelBeforeL: 520, levelAfterL: 340 },
      detectedAt: new Date(),
    },
  });
  const task = await prisma.task.create({
    data: {
      type: 'investigate_alert',
      payload: { alertId: alert.id },
      availableAt,
    },
  });
  return { alert, task };
}
