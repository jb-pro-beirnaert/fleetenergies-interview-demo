// Monde simulé (spec 04) : axe Marseille – Avignon – Valence – Lyon.
// Les définitions sont fixes ; seuls les identifiants dépendent de la graine (UUID v5).

import type {
  CarrierInput,
  DriverAssignmentInput,
  DriverInput,
  Energy,
  PlaceInput,
  PlaceType,
  TruckInputRef,
} from '@fleet/contracts';
import { v5 as uuidv5 } from 'uuid';
import type { Calendar } from './time.ts';

/** Espace de noms des UUID v5 du simulateur (valeur arbitraire, figée). */
const NAMESPACE = '3f6c2b1e-8d4a-4f7e-9b52-0c1d2e3f4a5b';

export const stableId = (seed: number, kind: string, code: string): string =>
  uuidv5(`${seed}:${kind}:${code}`, NAMESPACE);

export interface CarrierDef {
  code: string;
  name: string;
}

export interface PlaceDef {
  code: string;
  name: string;
  type: PlaceType;
  brand: string | null;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface TruckDef {
  code: string;
  carrier: string;
  plate: string;
  make: string;
  model: string;
  energy: Energy;
  tankCapacityL: number;
  hasReefer: boolean;
  baselineLPer100km: number;
  idleLPerHour: number;
  homeDepot: string;
  sensorNotes: string | null;
  /** Longue distance : nuit sur une aire d'autoroute en semaine. */
  longHaul: boolean;
  /** Sites clients desservis. */
  customers: readonly string[];
}

export interface DriverDef {
  code: string;
  carrier: string;
  fullName: string;
  phone: string;
}

export const CARRIERS: readonly CarrierDef[] = [
  { code: 'DURANCE', name: 'Transports Durance' },
  { code: 'FRIGOSUD', name: 'Frigo Sud' },
];

const place = (
  code: string,
  name: string,
  type: PlaceType,
  lat: number,
  lon: number,
  radiusM: number,
  brand: string | null = null,
): PlaceDef => ({ code, name, type, brand, lat, lon, radiusM });

export const PLACES: readonly PlaceDef[] = [
  // Dépôts
  place('DEP-MRS', 'Dépôt Transports Durance – Marseille Nord', 'depot', 43.3655, 5.364, 300),
  place('DEP-AVI', 'Dépôt Transports Durance – Avignon Courtine', 'depot', 43.923, 4.81, 300),
  place('DEP-CAV', 'Dépôt Frigo Sud – Cavaillon', 'depot', 43.845, 5.033, 300),
  // Atelier
  place('WS-PONTET', 'Atelier Poids Lourds du Pontet', 'workshop', 43.964, 4.866, 200),
  // Stations
  place('ST-AS24-VAL', 'AS24 Valence Sud', 'fuel_station', 44.889, 4.893, 120, 'AS24'),
  place('ST-AS24-VIT', 'AS24 Vitrolles', 'fuel_station', 43.447, 5.247, 120, 'AS24'),
  place('ST-AS24-STP', 'AS24 Lyon Saint-Priest', 'fuel_station', 45.708, 4.956, 120, 'AS24'),
  place('ST-TOT-PONTET', 'TotalEnergies Le Pontet', 'fuel_station', 43.97, 4.879, 120, 'TotalEnergies'),
  place('ST-TOT-MONT', 'TotalEnergies Montélimar Nord', 'fuel_station', 44.58, 4.755, 120, 'TotalEnergies'),
  place('ST-DKV-SALON', 'Station DKV Salon-de-Provence', 'fuel_station', 43.638, 5.083, 120, 'DKV'),
  place('ST-DKV-ORANGE', 'Station DKV Orange', 'fuel_station', 44.125, 4.824, 120, 'DKV'),
  place('ST-ROUX-BOLLENE', 'Garage Roux – Bollène', 'fuel_station', 44.281, 4.748, 120),
  // Aires d'autoroute (A7)
  place('RA-STRAMBERT', "Aire de Saint-Rambert-d'Albon", 'rest_area', 45.292, 4.815, 250),
  place('RA-PORTES', 'Aire de Portes-lès-Valence', 'rest_area', 44.873, 4.878, 250),
  place('RA-MONTELIMAR', 'Aire de Montélimar', 'rest_area', 44.595, 4.77, 250),
  place('RA-MORNAS', 'Aire de Mornas', 'rest_area', 44.202, 4.738, 250),
  place('RA-LANCON', 'Aire de Lançon-Provence', 'rest_area', 43.588, 5.178, 250),
  // Sites clients
  place('CU-FOS', 'Plateforme Méditerranée Logistique – Fos-sur-Mer', 'customer', 43.44, 4.942, 200),
  place('CU-STPRIEST', 'Entrepôt Rhône Distribution – Saint-Priest', 'customer', 45.72, 4.93, 200),
  place('CU-LYONPORT', 'Port Lyon Édouard-Herriot', 'customer', 45.73, 4.837, 200),
  place('CU-LORIOL', 'Drôme Emballages – Loriol-sur-Drôme', 'customer', 44.752, 4.815, 200),
  place('CU-VEDENE', 'Centrale Grand Delta – Vedène', 'customer', 43.978, 4.905, 200),
  place('CU-CHATEAURENARD', 'Coopérative fruitière de Châteaurenard', 'customer', 43.883, 4.856, 200),
  place('CU-CARPENTRAS', 'Primeurs du Comtat – Carpentras', 'customer', 44.048, 5.038, 200),
  place('CU-STREMY', 'Laiterie des Alpilles – Saint-Rémy-de-Provence', 'customer', 43.793, 4.838, 200),
];

const DURANCE_CUSTOMERS = ['CU-FOS', 'CU-STPRIEST', 'CU-LYONPORT', 'CU-LORIOL', 'CU-VEDENE', 'CU-CHATEAURENARD'];
const LONG_HAUL_CUSTOMERS = ['CU-FOS', 'CU-STPRIEST', 'CU-LYONPORT', 'CU-LORIOL'];
const FRIGO_CUSTOMERS = ['CU-CHATEAURENARD', 'CU-CARPENTRAS', 'CU-STREMY', 'CU-VEDENE', 'CU-LORIOL'];

type TruckSpec = Omit<TruckDef, 'carrier' | 'customers' | 'longHaul' | 'hasReefer' | 'sensorNotes'> &
  Partial<Pick<TruckDef, 'sensorNotes' | 'longHaul'>>;

const durance = (spec: TruckSpec): TruckDef => ({
  carrier: 'DURANCE',
  hasReefer: false,
  sensorNotes: null,
  longHaul: false,
  customers: spec.longHaul ? LONG_HAUL_CUSTOMERS : DURANCE_CUSTOMERS,
  ...spec,
});

const frigo = (spec: TruckSpec): TruckDef => ({
  carrier: 'FRIGOSUD',
  hasReefer: true,
  sensorNotes: null,
  longHaul: false,
  customers: FRIGO_CUSTOMERS,
  ...spec,
});

export const TRUCKS: readonly TruckDef[] = [
  durance({ code: 'T01', plate: 'FD-218-KM', make: 'Renault Trucks', model: 'T 480', energy: 'diesel', tankCapacityL: 600, baselineLPer100km: 31.5, idleLPerHour: 2.8, homeDepot: 'DEP-MRS' }),
  durance({ code: 'T02', plate: 'GA-541-PR', make: 'Volvo', model: 'FH 460', energy: 'hvo', tankCapacityL: 700, baselineLPer100km: 30.8, idleLPerHour: 2.9, homeDepot: 'DEP-MRS' }),
  durance({
    code: 'T03', plate: 'FK-307-BN', make: 'Scania', model: 'R 450', energy: 'diesel', tankCapacityL: 600, baselineLPer100km: 32.0, idleLPerHour: 3.0, homeDepot: 'DEP-MRS',
    sensorNotes: 'Sonde de niveau remplacée le 02/09/2026 ; valeurs erratiques signalées depuis par les conducteurs.',
  }),
  durance({ code: 'T04', plate: 'GB-772-LT', make: 'DAF', model: 'XF 480', energy: 'hvo', tankCapacityL: 650, baselineLPer100km: 31.0, idleLPerHour: 2.7, homeDepot: 'DEP-MRS' }),
  durance({ code: 'T05', plate: 'FH-126-DS', make: 'Mercedes-Benz', model: 'Actros 1845', energy: 'diesel', tankCapacityL: 600, baselineLPer100km: 30.5, idleLPerHour: 2.8, homeDepot: 'DEP-AVI' }),
  durance({ code: 'T06', plate: 'GC-903-AV', make: 'Iveco', model: 'S-Way 490', energy: 'diesel', tankCapacityL: 700, baselineLPer100km: 32.5, idleLPerHour: 3.1, homeDepot: 'DEP-AVI' }),
  durance({ code: 'T07', plate: 'FJ-458-RW', make: 'Volvo', model: 'FH 500 Globetrotter', energy: 'diesel', tankCapacityL: 800, baselineLPer100km: 33.0, idleLPerHour: 3.2, homeDepot: 'DEP-AVI', longHaul: true }),
  durance({ code: 'T08', plate: 'GD-384-HN', make: 'Renault Trucks', model: 'T 440', energy: 'hvo', tankCapacityL: 600, baselineLPer100km: 31.2, idleLPerHour: 2.9, homeDepot: 'DEP-AVI' }),
  frigo({ code: 'T09', plate: 'FL-615-CJ', make: 'Renault Trucks', model: 'D Wide 19 t frigorifique', energy: 'diesel', tankCapacityL: 400, baselineLPer100km: 27.5, idleLPerHour: 2.4, homeDepot: 'DEP-CAV' }),
  frigo({ code: 'T10', plate: 'GE-290-TZ', make: 'Volvo', model: 'FL 280 frigorifique', energy: 'diesel', tankCapacityL: 400, baselineLPer100km: 26.8, idleLPerHour: 2.3, homeDepot: 'DEP-CAV' }),
  frigo({ code: 'T11', plate: 'FM-847-VE', make: 'DAF', model: 'XD 19 t frigorifique', energy: 'diesel', tankCapacityL: 450, baselineLPer100km: 28.2, idleLPerHour: 2.5, homeDepot: 'DEP-CAV' }),
  frigo({ code: 'T12', plate: 'GF-163-SB', make: 'Mercedes-Benz', model: 'Atego 1530 frigorifique', energy: 'diesel', tankCapacityL: 450, baselineLPer100km: 28.0, idleLPerHour: 2.4, homeDepot: 'DEP-CAV' }),
];

// Numéros dans la tranche réservée à la fiction (06 39 98 xx xx).
export const DRIVERS: readonly DriverDef[] = [
  { code: 'C-01', carrier: 'DURANCE', fullName: 'Karim Benali', phone: '06 39 98 41 27' },
  { code: 'C-02', carrier: 'DURANCE', fullName: 'Julien Marchetti', phone: '06 39 98 52 08' },
  { code: 'C-03', carrier: 'DURANCE', fullName: 'Sébastien Fabre', phone: '06 39 98 13 64' },
  { code: 'C-04', carrier: 'DURANCE', fullName: 'Mickaël Durand', phone: '06 39 98 70 91' },
  { code: 'C-05', carrier: 'DURANCE', fullName: 'Nadia Ferhat', phone: '06 39 98 26 45' },
  { code: 'C-06', carrier: 'DURANCE', fullName: 'Thierry Garcia', phone: '06 39 98 88 12' },
  { code: 'C-07', carrier: 'DURANCE', fullName: 'Rachid Ouali', phone: '06 39 98 34 79' },
  { code: 'C-08', carrier: 'DURANCE', fullName: 'Laurent Pellegrin', phone: '06 39 98 61 50' },
  { code: 'C-09', carrier: 'DURANCE', fullName: 'Antoine Mercier', phone: '06 39 98 19 83' },
  { code: 'C-10', carrier: 'FRIGOSUD', fullName: 'Sophie Arnaud', phone: '06 39 98 45 36' },
  { code: 'C-11', carrier: 'FRIGOSUD', fullName: 'Mehdi Saïdi', phone: '06 39 98 92 17' },
  { code: 'C-12', carrier: 'FRIGOSUD', fullName: 'Christophe Blanc', phone: '06 39 98 07 68' },
  { code: 'C-13', carrier: 'FRIGOSUD', fullName: 'Élodie Martin', phone: '06 39 98 53 24' },
  { code: 'C-14', carrier: 'FRIGOSUD', fullName: 'Yannick Bertrand', phone: '06 39 98 76 40' },
];

export interface World {
  seed: number;
  cal: Calendar;
  carriers: readonly CarrierDef[];
  places: readonly PlaceDef[];
  trucks: readonly TruckDef[];
  drivers: readonly DriverDef[];
  place(code: string): PlaceDef;
  truck(code: string): TruckDef;
  driver(code: string): DriverDef;
  /** Conducteur affecté au camion pour un jour donné (rotation dans le transporteur). */
  driverOf(truckCode: string, day: number): DriverDef;
  id(kind: 'carrier' | 'place' | 'truck' | 'driver', code: string): string;
}

const byCode = <T extends { code: string }>(items: readonly T[], label: string) => {
  const map = new Map(items.map((item) => [item.code, item]));
  return (code: string): T => {
    const item = map.get(code);
    if (!item) throw new Error(`${label} inconnu : ${code}`);
    return item;
  };
};

export function buildWorld(seed: number, cal: Calendar): World {
  const truck = byCode(TRUCKS, 'Camion');
  return {
    seed,
    cal,
    carriers: CARRIERS,
    places: PLACES,
    trucks: TRUCKS,
    drivers: DRIVERS,
    place: byCode(PLACES, 'Lieu'),
    truck,
    driver: byCode(DRIVERS, 'Conducteur'),
    driverOf(truckCode, day) {
      const target = truck(truckCode);
      const fleet = TRUCKS.filter((t) => t.carrier === target.carrier);
      const crew = DRIVERS.filter((d) => d.carrier === target.carrier);
      return crew[(fleet.indexOf(target) + day) % crew.length];
    },
    id: (kind, code) => stableId(seed, kind, code),
  };
}

export const firstName = (driver: DriverDef): string =>
  driver.fullName.split(' ')[0];

export interface Reference {
  carriers: CarrierInput[];
  places: PlaceInput[];
  trucks: TruckInputRef[];
  drivers: DriverInput[];
  assignments: DriverAssignmentInput[];
}

/** Référentiel au format des contrats (`HistoryLoadBatch`). */
export function buildReference(world: World): Reference {
  const assignments: DriverAssignmentInput[] = [];
  const { cal } = world;
  for (let day = 0; day < cal.days; day++) {
    for (const truck of world.trucks) {
      const driver = world.driverOf(truck.code, day);
      assignments.push({
        id: stableId(world.seed, 'assignment', `${truck.code}:${cal.date(day)}`),
        truckId: world.id('truck', truck.code),
        driverId: world.id('driver', driver.code),
        startsAt: cal.toIso(cal.dayStart(day)),
        endsAt: cal.toIso(cal.dayStart(day + 1)),
      });
    }
  }
  return {
    carriers: world.carriers.map((c) => ({ id: world.id('carrier', c.code), name: c.name })),
    places: world.places.map((p) => ({
      id: world.id('place', p.code),
      name: p.name,
      type: p.type,
      brand: p.brand,
      lat: p.lat,
      lon: p.lon,
      radiusM: p.radiusM,
    })),
    trucks: world.trucks.map((t) => ({
      id: world.id('truck', t.code),
      carrierId: world.id('carrier', t.carrier),
      plate: t.plate,
      make: t.make,
      model: t.model,
      energy: t.energy,
      tankCapacityL: t.tankCapacityL,
      hasReefer: t.hasReefer,
      baselineLPer100km: t.baselineLPer100km,
      idleLPerHour: t.idleLPerHour,
      homeDepotId: world.id('place', t.homeDepot),
      sensorNotes: t.sensorNotes,
    })),
    drivers: world.drivers.map((d) => ({
      id: world.id('driver', d.code),
      carrierId: world.id('carrier', d.carrier),
      fullName: d.fullName,
      phone: d.phone,
      pseudonym: d.code,
    })),
    assignments,
  };
}
