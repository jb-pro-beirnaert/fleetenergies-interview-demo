import { extractText, getDocumentProxy } from 'unpdf';
import { beforeAll, describe, expect, it } from 'vitest';
import { B3_INJECTION } from './billing.ts';
import { generate } from './generate.ts';
import { formatDate, formatNumber, renderInvoices } from './invoice-pdf.ts';
import type { InvoicePlan } from './invoices.ts';

/** Same frozen start as `generate.spec.ts`: the week uses the 4 templates. */
const START = Date.parse('2026-11-06T09:02:00Z');

/** Text of a PDF, with the library the API will use (unpdf). */
async function pdfText(pdf: Uint8Array): Promise<string> {
  const document = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(document, { mergePages: true });
  return text;
}

async function textsOf(plans: readonly InvoicePlan[]): Promise<Map<string, string>> {
  const pdfs = await renderInvoices(plans);
  const texts = new Map<string, string>();
  for (const [file, pdf] of pdfs) texts.set(file, await pdfText(pdf));
  return texts;
}

/** Same pattern as the API's injection detection (spec 03). */
const INJECTION_PATTERN = /ignore\b.*\binstructions?/i;

describe('invoice PDFs', () => {
  let plans: InvoicePlan[];
  let texts: Map<string, string>;

  beforeAll(async () => {
    plans = generate(42, START).invoices;
    texts = await textsOf(plans);
  });

  it('1. each PDF is a text PDF whose text contains the billed liters and total, the plate and the invoice number', () => {
    expect(texts.size).toBe(plans.length);
    for (const plan of plans) {
      const text = texts.get(plan.file)!;
      const doc = plan.document;
      expect(text, plan.id).toContain(formatNumber(doc.liters, 2, doc.messy));
      expect(text, plan.id).toContain(formatNumber(doc.totalEur, 2, doc.messy));
      expect(text, plan.id).toContain(doc.messy ? doc.plate.replaceAll('-', '') : doc.plate);
      expect(text, plan.id).toContain(doc.invoiceNumber);
      expect(text, plan.id).toContain(doc.station.city);
    }
  });

  it('B1 bills 412 L although the card transaction says 250 L', () => {
    const b1 = plans.find((plan) => plan.id === 'B1-overbilled')!;
    expect(b1.refuel.liters).toBe(250);
    expect(texts.get(b1.file)).toContain('412.00');
    expect(texts.get(b1.file)).not.toContain('250.00');
  });

  it('B4: decimal commas, amounts excluding and including VAT, plate without dashes, "14 Oct 2026" date', () => {
    const b4 = plans.find((plan) => plan.id === 'B4-messy')!;
    const text = texts.get(b4.file)!;
    expect(text).toContain(b4.plate.replaceAll('-', ''));
    expect(text).not.toContain(b4.plate);
    expect(text).toContain(formatNumber(b4.document.netEur, 2, true));
    expect(text).toContain(formatNumber(b4.document.unitPriceExVatEur, 4, true));
    expect(text).toContain(formatDate(b4.document.refuelDate, 'long'));
    expect(formatDate('2026-10-14', 'long')).toBe('14 Oct 2026');
    expect(text).not.toMatch(/\d\.\d{2}\b/);
  });

  it('3. the injection sentence only appears in invoice B3, and matches the API detection pattern', () => {
    for (const plan of plans) {
      const text = texts.get(plan.file)!.replace(/\s+/g, ' ');
      if (plan.id === 'B3-injection') {
        expect(text).toContain(B3_INJECTION);
        expect(text).toMatch(INJECTION_PATTERN);
      } else {
        expect(text, plan.id).not.toMatch(INJECTION_PATTERN);
      }
    }
  });

  it('2. the 4 templates are different documents', () => {
    const marker = { as24: 'AS24', totalenergies: 'TotalEnergies', dkv: 'DKV', independent: 'GARAGE ROUX' } as const;
    const byTemplate = new Map(plans.map((plan) => [plan.document.template, texts.get(plan.file)!]));
    expect(byTemplate.size).toBe(4);
    for (const [template, text] of byTemplate) expect(text.startsWith(marker[template]), template).toBe(true);
    expect(byTemplate.get('dkv')).toMatch(/sub-total/i);
  });

  it('4. another start changes the form, never the figures set by the code', async () => {
    const same = generate(42, START).invoices;
    expect((await textsOf(same.slice(0, 3))).get(same[0].file)).toBe(texts.get(same[0].file));

    // Same facts, other style key: wording and numbering may change, the printed figures stay
    const restyled = plans.map((plan) => ({
      ...plan,
      document: { ...plan.document, styleKey: `${plan.document.styleKey}:other` },
    }));
    const other = await textsOf(restyled);
    let changed = 0;
    for (const plan of restyled) {
      const text = other.get(plan.file)!;
      expect(text).toContain(formatNumber(plan.document.liters, 2, plan.document.messy));
      expect(text).toContain(formatNumber(plan.document.totalEur, 2, plan.document.messy));
      if (text !== texts.get(plan.file)) changed++;
    }
    expect(changed).toBeGreaterThan(plans.length / 2);
  });
});
