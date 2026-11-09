// V2 invoices plan (spec 04 and 10): the code sets every fact of each invoice (supplier, station,
// date, plate, liters, prices, amounts) and the values expected from the extraction. The PDF
// rendering (`invoice-pdf.ts`) only dresses these facts up, with variations drawn at each start.

import type { FuelCardTransaction, InvoiceExtraction, InvoiceFuelType, VerdictCategory } from '@fleet/contracts';
import {
  B2_INVOICE_COUNT,
  BILLING_SCENARIOS,
  INVOICE_DELAY_MIN,
  type BillingScenarioDef,
  type BillingScenarioId,
} from './billing.ts';
import { createRng, round, type Rng } from './rng.ts';
import type { SimRefuel, TruckSim } from './simulate.ts';
import { localDateOf, localHHMM } from './time.ts';
import type { PlaceDef, World } from './world.ts';

export type InvoiceTemplate = 'as24' | 'totalenergies' | 'dkv' | 'independent';

export const INVOICE_TEMPLATES: readonly InvoiceTemplate[] = ['as24', 'totalenergies', 'dkv', 'independent'];

export const VAT_RATE = 0.2;

interface StationInfo {
  street: string;
  postcode: string;
  city: string;
}

/** Fictional addresses of the fuel stations. */
const STATIONS: Record<string, StationInfo> = {
  'ST-AS24-VAL': { street: 'ZA Les Auréats, rue de la Forêt', postcode: '26000', city: 'Valence' },
  'ST-AS24-VIT': { street: 'ZI Les Estroublans, avenue de l’Europe', postcode: '13127', city: 'Vitrolles' },
  'ST-AS24-STP': { street: 'Rue du Lieutenant-Colonel Girard', postcode: '69800', city: 'Saint-Priest' },
  'ST-TOT-PONTET': { street: '240 route de Lyon', postcode: '84130', city: 'Le Pontet' },
  'ST-TOT-MONT': { street: 'RN7 Nord, Les Portes de Provence', postcode: '26200', city: 'Montélimar' },
  'ST-DKV-SALON': { street: 'Zone Les Viougues, chemin de la Crau', postcode: '13300', city: 'Salon-de-Provence' },
  'ST-DKV-ORANGE': { street: 'ZAC du Coudoulet, route de Caderousse', postcode: '84100', city: 'Orange' },
  'ST-ROUX-BOLLENE': { street: '12 avenue Émile Zola', postcode: '84500', city: 'Bollène' },
};

interface Issuer {
  /** Expected `supplier` value. */
  supplier: string;
  /** Letterhead lines. */
  lines: string[];
  vatId: string;
}

/** Fictional issuers (identifiers deliberately invalid). */
const ISSUERS: Record<InvoiceTemplate, Issuer> = {
  as24: {
    supplier: 'AS24',
    lines: ['AS24 – Fuel network for heavy goods vehicles', 'Customer service: 1 rue du Réseau, 44000 Nantes'],
    vatId: 'FR00 000 000 024',
  },
  totalenergies: {
    supplier: 'TotalEnergies',
    lines: ['TotalEnergies Marketing – Fleet services', 'Service station network'],
    vatId: 'FR00 000 000 117',
  },
  dkv: {
    supplier: 'DKV',
    lines: ['DKV Mobility – Fuel card statement', 'Card services, 40880 Ratingen'],
    vatId: 'DE000000000',
  },
  independent: {
    supplier: 'Garage Roux',
    lines: ['GARAGE ROUX – Fuel & truck repairs', 'Family business since 1972 – Tel. on request'],
    vatId: 'FR00 000 000 845',
  },
};

export const templateOf = (station: PlaceDef): InvoiceTemplate => {
  switch (station.brand) {
    case 'AS24':
      return 'as24';
    case 'TotalEnergies':
      return 'totalenergies';
    case 'DKV':
      return 'dkv';
    default:
      return 'independent';
  }
};

/** Everything printed on an invoice. Figures are set here, never by the rendering. */
export interface InvoiceDocument {
  template: InvoiceTemplate;
  supplier: string;
  issuer: { lines: string[]; vatId: string };
  invoiceNumber: string;
  /** Issue date (Paris, YYYY-MM-DD). */
  issuedAt: string;
  /** Refuel date and time (Paris). */
  refuelDate: string;
  refuelTime: string;
  station: { name: string; street: string; postcode: string; city: string };
  carrier: string;
  /** Normalised plate (`AB-123-CD`); B4 prints it without dashes. */
  plate: string;
  /** Masked fuel card number. */
  cardNumber: string;
  product: string;
  fuelType: InvoiceFuelType;
  liters: number;
  /** Unit price including VAT. */
  unitPriceEur: number;
  unitPriceExVatEur: number;
  netEur: number;
  vatEur: number;
  /** Amount including VAT. */
  totalEur: number;
  /** Decimal commas, amounts excl. and incl. VAT, plate without dashes, "14 Oct 2026" date (B4). */
  messy: boolean;
  /** Hidden instruction printed in small type (B3). */
  injection: string | null;
  /** Key of the layout variations (labels, date format, column order) drawn at each start. */
  styleKey: string;
}

export interface InvoicePlan {
  /** `B1-overbilled`, `B2-normal-01`…, `B3-injection`, `B4-messy`. */
  id: string;
  scenario: BillingScenarioId;
  file: string;
  truck: string;
  truckId: string;
  plate: string;
  /** Matching card transaction: what was actually delivered. */
  refuel: FuelCardTransaction;
  /** Sending instant (`POST /api/invoices`): 30 simulated minutes after the refuel. */
  receivedAt: string;
  document: InvoiceDocument;
  /** Exact values expected from the extraction. */
  expected: InvoiceExtraction;
  expectedStatus: 'matched' | 'mismatch';
  expectedCategory: VerdictCategory | null;
}

const PRODUCTS: Record<'diesel' | 'hvo', readonly string[]> = {
  diesel: ['Diesel B7', 'Diesel (B7) – road', 'Gasoil B7'],
  hvo: ['HVO100', 'HVO 100 renewable diesel', 'XTL / HVO100'],
};

const digits = (rng: Rng, count: number) =>
  Array.from({ length: count }, (_, i) => rng.int(i === 0 ? 1 : 0, 9)).join('');

function invoiceNumber(rng: Rng, template: InvoiceTemplate, date: string): string {
  const [yyyy, mm, dd] = date.split('-');
  const yy = yyyy.slice(2);
  switch (template) {
    case 'as24':
      return rng.pick([`AS24-${yy}${mm}-${digits(rng, 6)}`, `F${yyyy}${digits(rng, 7)}`]);
    case 'totalenergies':
      return rng.pick([`TE${yyyy}${mm}${dd}-${digits(rng, 5)}`, `FAC-${digits(rng, 9)}`]);
    case 'dkv':
      return rng.pick([`DKV/${yyyy}/${digits(rng, 8)}`, `ST-${yy}${mm}-${digits(rng, 6)}`]);
    case 'independent':
      return rng.pick([`${yyyy}-${digits(rng, 4)}`, `N° ${rng.int(100, 999)}/${yy}`]);
  }
}

interface Candidate {
  sim: TruckSim;
  refuel: SimRefuel;
}

/**
 * Invoices of the demo week: B1, B3, B4 on their scripted refuel, and up to `B2_INVOICE_COUNT`
 * ordinary invoices spread over the 4 templates. Only refuels whose invoice is sent before the
 * end of the week are invoiced.
 */
export function buildInvoicePlan(world: World, sims: readonly TruckSim[], liveStartIso: string): InvoicePlan[] {
  const { cal } = world;
  const rng = createRng(world.seed, 'invoices', liveStartIso);
  const sendable = (refuel: SimRefuel) =>
    refuel.minute >= cal.liveStartMin && refuel.minute + INVOICE_DELAY_MIN <= cal.liveEndMin;

  const plans: InvoicePlan[] = [];
  const plan = (id: string, scenario: BillingScenarioId, { sim, refuel }: Candidate, event?: BillingScenarioDef) => {
    const station = world.place(refuel.placeCode);
    const template = templateOf(station);
    const issuer = ISSUERS[template];
    const address = STATIONS[station.code];
    if (!address) throw new Error(`No invoice address for station ${station.code}`);
    const utcMs = Date.parse(cal.toIso(refuel.minute));
    const refuelDate = localDateOf(utcMs);
    const fuelType = sim.truck.energy === 'hvo' ? 'hvo' : 'diesel';
    const liters = round(refuel.liters + (event?.overbilledL ?? 0), 2);
    const unitPriceEur = refuel.unitPriceEur;
    const totalEur = round(liters * unitPriceEur, 2);
    const netEur = round(totalEur / (1 + VAT_RATE), 2);
    const number = invoiceNumber(rng, template, refuelDate);
    const truckId = world.id('truck', sim.truck.code);
    const occurredAt = cal.toIso(refuel.minute);
    const document: InvoiceDocument = {
      template,
      supplier: issuer.supplier,
      issuer: { lines: issuer.lines, vatId: issuer.vatId },
      invoiceNumber: number,
      issuedAt: refuelDate,
      refuelDate,
      refuelTime: localHHMM(utcMs),
      station: { name: station.name, ...address },
      carrier: world.carriers.find((c) => c.code === sim.truck.carrier)!.name,
      plate: sim.truck.plate,
      cardNumber: `7077 **** **** ${String(1000 + ((world.trucks.indexOf(sim.truck) + 3) * 2_741) % 9000)}`,
      product: rng.pick(PRODUCTS[fuelType]),
      fuelType,
      liters,
      unitPriceEur,
      unitPriceExVatEur: round(unitPriceEur / (1 + VAT_RATE), 4),
      netEur,
      vatEur: round(totalEur - netEur, 2),
      totalEur,
      messy: event?.messy ?? false,
      injection: event?.injection ?? null,
      styleKey: `${world.seed}:${liveStartIso}:${id}`,
    };
    plans.push({
      id,
      scenario,
      file: `${id}.pdf`,
      truck: sim.truck.code,
      truckId,
      plate: sim.truck.plate,
      refuel: {
        truckId,
        occurredAt,
        placeId: world.id('place', station.code),
        liters: refuel.liters,
        unitPriceEur: refuel.unitPriceEur,
        totalEur: refuel.totalEur,
      },
      receivedAt: cal.toIso(refuel.minute + INVOICE_DELAY_MIN),
      document,
      expected: {
        supplier: issuer.supplier,
        invoiceNumber: number,
        issuedAt: refuelDate,
        refuelAt: occurredAt,
        stationName: station.name,
        stationCity: address.city,
        plate: sim.truck.plate,
        fuelType,
        liters,
        unitPriceEur,
        totalEur,
        currency: 'EUR',
        suspiciousContent: document.injection !== null,
        suspiciousExcerpt: document.injection,
        confidenceNotes: null,
      },
      expectedStatus: event?.expectedStatus ?? 'matched',
      expectedCategory: event?.expectedCategory ?? null,
    });
  };

  const simOf = (code: string) => sims.find((sim) => sim.truck.code === code)!;
  for (const event of BILLING_SCENARIOS) {
    const sim = simOf(event.truck);
    const refuel = sim.refuels.find((r) => r.label === event.id);
    if (!refuel || !sendable(refuel)) throw new Error(`${event.id}: scripted refuel missing from the demo week`);
    plan(event.id, event.id, { sim, refuel }, event);
  }

  // B2: ordinary refuels of the week, drawn template by template (round robin) for variety
  const pools = new Map<InvoiceTemplate, Candidate[]>(INVOICE_TEMPLATES.map((t) => [t, []]));
  for (const sim of sims) {
    for (const refuel of sim.refuels) {
      if (refuel.label || !sendable(refuel)) continue;
      pools.get(templateOf(world.place(refuel.placeCode)))!.push({ sim, refuel });
    }
  }
  for (const [template, pool] of pools) pools.set(template, rng.shuffle(pool));
  const picked: Candidate[] = [];
  while (picked.length < B2_INVOICE_COUNT && [...pools.values()].some((pool) => pool.length > 0)) {
    for (const pool of pools.values()) {
      const next = pool.shift();
      if (next && picked.length < B2_INVOICE_COUNT) picked.push(next);
    }
  }
  picked
    .sort((a, b) => a.refuel.minute - b.refuel.minute)
    .forEach((candidate, index) => plan(`B2-normal-${String(index + 1).padStart(2, '0')}`, 'B2-normal', candidate));

  return plans.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
}
