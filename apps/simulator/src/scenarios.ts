// Scénarios injectés dans les courbes (spec 04, « Scénarios de la journée de démo »).

import type { PlaceType, VerdictCategory } from '@fleet/contracts';
import { firstName, type DriverDef } from './world.ts';

export type ScenarioKind =
  /** Carburant réellement retiré du réservoir (vol, transfert, vidange). */
  | 'drain'
  /** Artefact de sonde : seules les valeurs mesurées chutent, puis remontent. */
  | 'sensor_artifact';

export interface ScenarioDef {
  id: string;
  truck: string;
  /** Jour de l'épisode relatif à la journée de démo (0 = journée de démo, −5 = cinq jours avant). */
  dayOffset: number;
  time: string;
  kind: ScenarioKind;
  amountL: number;
  /** Durée du retrait, ou de l'artefact (relevés faussés sur cet intervalle). */
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
    situation: "Aire d'autoroute, nuit, moteur coupé, −180 L en 12 min",
    clues: [
      'aucun plein',
      'aucun message',
      'historique : deux chutes nocturnes de −55 L (J − 11) et −60 L (J − 5) sur des aires',
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
    situation: 'Chez un client, −90 L en un relevé puis remontée dix minutes après',
    clues: ['sensor_notes renseigné', 'message du conducteur : la jauge affiche n’importe quoi'],
    expectedCategory: 'sensor_fault',
    acceptableCategories: ['sensor_fault'],
    message: {
      time: '07:22',
      body: () =>
        "La jauge carburant affiche n'importe quoi depuis ce matin : elle a chuté d'un coup puis elle est remontée. Je n'ai rien touché, je suis à quai chez le client.",
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
    situation: 'Site client, frigorifique, −50 L en 10 min',
    clues: ['has_reefer', 'message : plein du groupe froid fait depuis le réservoir principal'],
    expectedCategory: 'equipment_transfer',
    acceptableCategories: ['equipment_transfer'],
    message: {
      time: '11:18',
      body: () =>
        'Plein du réservoir du groupe froid fait depuis le réservoir principal avant la tournée de cet après-midi.',
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
    situation: 'Atelier poids lourds, −120 L',
    clues: ['message avec nom et téléphone du mécanicien (masquage)', 'réservoir vidangé pour réparer une fuite'],
    expectedCategory: 'legitimate_operation',
    acceptableCategories: ['legitimate_operation'],
    message: {
      time: '14:26',
      body: (driver) =>
        `Bonjour, c'est ${firstName(driver)}. Je suis à l'atelier, ils vidangent le réservoir pour réparer une fuite sur le circuit gasoil. Contact du mécanicien : Marc Lefèvre, 06 39 98 77 05.`,
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
    situation: 'Station-service, nuit, moteur coupé, −70 L',
    clues: ['aucun plein', 'aucun message', 'aucun antécédent'],
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
    situation: 'Dépôt, artefact −55 L / +52 L',
    clues: ['remontée seulement'],
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
    situation: 'Aire, artefact −48 L / +47 L',
    clues: ['remontée seulement'],
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
    situation: 'Client, frigorifique, −45 L',
    clues: ['has_reefer', 'sans message'],
    expectedCategory: 'equipment_transfer',
    acceptableCategories: ['equipment_transfer', 'inconclusive'],
  },
];

/** Antécédents de S1 dans l'historique (aucune alerte : la détection ne porte que sur le `live`). */
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
    situation: "Chute nocturne sur une aire d'autoroute, moteur coupé",
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
    situation: "Chute nocturne sur une aire d'autoroute, moteur coupé",
    clues: [],
    expectedCategory: 'theft_suspected',
    acceptableCategories: ['theft_suspected'],
  },
];

/** Décision attendue de l'API (spec 03, « Décision après verdict »). */
export const expectedDecision = (category: VerdictCategory) =>
  category === 'theft_suspected' ||
  category === 'billing_discrepancy' ||
  category === 'inconclusive'
    ? 'escalated'
    : 'auto_closed_if_confident';
