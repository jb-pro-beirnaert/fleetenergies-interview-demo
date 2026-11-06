// Scenarios injected into the curves (spec 04, "Demo day scenarios").

import type { PlaceType, VerdictCategory } from '@fleet/contracts';
import { firstName, type DriverDef } from './world.ts';

export type ScenarioKind =
  /** Fuel actually taken out of the tank (theft, transfer, draining). */
  | 'drain'
  /** Sensor artefact: only the measured values drop, then rise again. */
  | 'sensor_artifact';

export interface ScenarioDef {
  id: string;
  truck: string;
  /** Day of the episode relative to the demo day (0 = demo day, −5 = five days before). */
  dayOffset: number;
  time: string;
  kind: ScenarioKind;
  amountL: number;
  /** Duration of the withdrawal, or of the artefact (readings skewed over that interval). */
  durationMin: number;
  placeType: PlaceType;
  situation: string;
  clues: string[];
  expectedCategory: VerdictCategory;
  acceptableCategories: VerdictCategory[];
  message?: { time: string; body: (driver: DriverDef) => string };
}

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'S1-theft',
    truck: 'T07',
    dayOffset: 0,
    time: '02:35',
    kind: 'drain',
    amountL: 180,
    durationMin: 12,
    placeType: 'rest_area',
    situation: 'Motorway rest area, night, engine off, −180 L in 12 min',
    clues: [
      'no refuel',
      'no message',
      'history: two night-time drops of −55 L (D − 11) and −60 L (D − 5) at rest areas',
    ],
    expectedCategory: 'theft_suspected',
    acceptableCategories: ['theft_suspected'],
  },
  {
    id: 'S2-sensor',
    truck: 'T03',
    dayOffset: 0,
    time: '07:10',
    kind: 'sensor_artifact',
    amountL: 90,
    durationMin: 10,
    placeType: 'customer',
    situation: 'At a customer, −90 L in one reading then back up ten minutes later',
    clues: ['sensor_notes filled in', 'driver message: the gauge is showing nonsense'],
    expectedCategory: 'sensor_fault',
    acceptableCategories: ['sensor_fault'],
    message: {
      time: '07:22',
      body: () =>
        'The fuel gauge has been showing nonsense since this morning: it dropped all of a sudden and then went back up. I did not touch anything, I am at the loading bay at the customer.',
    },
  },
  {
    id: 'S3-reefer',
    truck: 'T10',
    dayOffset: 0,
    time: '11:05',
    kind: 'drain',
    amountL: 50,
    durationMin: 10,
    placeType: 'customer',
    situation: 'Customer site, refrigerated truck, −50 L in 10 min',
    clues: ['has_reefer', 'message: reefer unit filled up from the main tank'],
    expectedCategory: 'equipment_transfer',
    acceptableCategories: ['equipment_transfer'],
    message: {
      time: '11:18',
      body: () =>
        'Filled up the reefer unit tank from the main tank before this afternoon’s round.',
    },
  },
  {
    id: 'S4-workshop',
    truck: 'T05',
    dayOffset: 0,
    time: '14:20',
    kind: 'drain',
    amountL: 120,
    durationMin: 20,
    placeType: 'workshop',
    situation: 'Truck workshop, −120 L',
    clues: ['message with the mechanic’s name and phone number (masking)', 'tank drained to fix a leak'],
    expectedCategory: 'legitimate_operation',
    acceptableCategories: ['legitimate_operation'],
    message: {
      time: '14:26',
      body: (driver) =>
        `Hello, it's ${firstName(driver)}. I'm at the workshop, they are draining the tank to fix a leak in the diesel line. Mechanic's contact: Marc Lefèvre, 06 39 98 77 05.`,
    },
  },
  {
    id: 'S5-ambiguous',
    truck: 'T09',
    dayOffset: 0,
    time: '22:40',
    kind: 'drain',
    amountL: 70,
    durationMin: 15,
    placeType: 'fuel_station',
    situation: 'Fuel station, night, engine off, −70 L',
    clues: ['no refuel', 'no message', 'no prior event'],
    expectedCategory: 'inconclusive',
    acceptableCategories: ['inconclusive', 'theft_suspected'],
  },
  {
    id: 'S6-sensor',
    truck: 'T01',
    dayOffset: 0,
    time: '05:50',
    kind: 'sensor_artifact',
    amountL: 55,
    durationMin: 10,
    placeType: 'depot',
    situation: 'Depot, artefact −55 L / +52 L',
    clues: ['rise only'],
    expectedCategory: 'sensor_fault',
    acceptableCategories: ['sensor_fault'],
  },
  {
    id: 'S7-sensor',
    truck: 'T12',
    dayOffset: 0,
    time: '16:30',
    kind: 'sensor_artifact',
    amountL: 48,
    durationMin: 10,
    placeType: 'rest_area',
    situation: 'Rest area, artefact −48 L / +47 L',
    clues: ['rise only'],
    expectedCategory: 'sensor_fault',
    acceptableCategories: ['sensor_fault'],
  },
  {
    id: 'S8-reefer',
    truck: 'T11',
    dayOffset: 0,
    time: '19:15',
    kind: 'drain',
    amountL: 45,
    durationMin: 10,
    placeType: 'customer',
    situation: 'Customer, refrigerated truck, −45 L',
    clues: ['has_reefer', 'no message'],
    expectedCategory: 'equipment_transfer',
    acceptableCategories: ['equipment_transfer', 'inconclusive'],
  },
];

/** S1's prior events in the history (no alert: detection only covers `live` data). */
export const HISTORY_EVENTS: readonly ScenarioDef[] = [
  {
    id: 'H1-theft',
    truck: 'T07',
    dayOffset: -11,
    time: '03:10',
    kind: 'drain',
    amountL: 55,
    durationMin: 15,
    placeType: 'rest_area',
    situation: 'Night-time drop at a motorway rest area, engine off',
    clues: [],
    expectedCategory: 'theft_suspected',
    acceptableCategories: ['theft_suspected'],
  },
  {
    id: 'H2-theft',
    truck: 'T07',
    dayOffset: -5,
    time: '01:50',
    kind: 'drain',
    amountL: 60,
    durationMin: 15,
    placeType: 'rest_area',
    situation: 'Night-time drop at a motorway rest area, engine off',
    clues: [],
    expectedCategory: 'theft_suspected',
    acceptableCategories: ['theft_suspected'],
  },
];

/** Expected API decision (spec 03, "Decision after the verdict"). */
export const expectedDecision = (category: VerdictCategory) =>
  category === 'theft_suspected' ||
  category === 'billing_discrepancy' ||
  category === 'inconclusive'
    ? 'escalated'
    : 'auto_closed_if_confident';
