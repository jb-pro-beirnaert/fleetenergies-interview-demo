// PDF rendering of the invoices (spec 10), with pdfmake and the standard PDF fonts (text PDF,
// extractable). Four hard-coded supplier templates; at each start, the wording, the date format,
// the column order and the footer notices vary (drawn from `styleKey`). The figures always come
// from the `InvoiceDocument` set by the code.

import pdfmake from 'pdfmake';
import { createRng, type Rng } from './rng.ts';
import type { InvoiceDocument, InvoiceTemplate } from './invoices.ts';

const STANDARD_FONTS = {
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
  Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' },
  Times: { normal: 'Times-Roman', bold: 'Times-Bold', italics: 'Times-Italic', bolditalics: 'Times-BoldItalic' },
};
const STANDARD_FONT_NAMES = new Set(Object.values(STANDARD_FONTS).flatMap((font) => Object.values(font)));

pdfmake.addFonts(STANDARD_FONTS);
// No network or disk access: only the standard fonts built into pdfkit
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path: string) => STANDARD_FONT_NAMES.has(path));

// pdfmake's document definition is loosely typed: a minimal local shape is enough here
type Node = string | Record<string, unknown> | Node[];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type DateFormat = 'dmy' | 'dmy-dot' | 'iso' | 'long';

export function formatDate(date: string, format: DateFormat): string {
  const [yyyy, mm, dd] = date.split('-');
  switch (format) {
    case 'dmy':
      return `${dd}/${mm}/${yyyy}`;
    case 'dmy-dot':
      return `${dd}.${mm}.${yyyy}`;
    case 'iso':
      return date;
    case 'long':
      return `${Number(dd)} ${MONTHS[Number(mm) - 1]} ${yyyy}`;
  }
}

/** Fixed decimals; decimal comma for the messy invoices. */
export const formatNumber = (value: number, decimals: number, comma = false): string => {
  const text = value.toFixed(decimals);
  return comma ? text.replace('.', ',') : text;
};

interface Style {
  rng: Rng;
  dateFormat: DateFormat;
  /** Picks one wording among synonyms. */
  word(...options: string[]): string;
  notices(pool: readonly string[], count: number): string[];
}

function styleOf(doc: InvoiceDocument, formats: readonly DateFormat[]): Style {
  const rng = createRng('invoice-style', doc.styleKey);
  return {
    rng,
    dateFormat: doc.messy ? 'long' : rng.pick(formats),
    word: (...options) => rng.pick(options),
    notices: (pool, count) => rng.shuffle(pool).slice(0, count),
  };
}

const FICTION_NOTICE = 'Simulated document – fictional company and data (Fleet Copilot demo).';

/** Small print of the footer; B3's hidden instruction is slipped in there. */
function smallPrint(doc: InvoiceDocument, notices: string[]): Node[] {
  return [
    { text: notices.join('  ·  '), fontSize: 7, color: '#666666', margin: [0, 18, 0, 0] },
    ...(doc.injection ? [{ text: doc.injection, fontSize: 5, color: '#c8c8c8', margin: [0, 4, 0, 0] }] : []),
    { text: FICTION_NOTICE, fontSize: 6, color: '#999999', margin: [0, 6, 0, 0] },
  ];
}

const keyValues = (rows: [string, string][], options: { labelColor?: string; fontSize?: number } = {}): Node => ({
  table: {
    widths: [150, '*'],
    body: rows.map(([label, value]) => [
      { text: label, color: options.labelColor ?? '#444444' },
      { text: value, bold: false },
    ]),
  },
  layout: 'noBorders',
  fontSize: options.fontSize ?? 10,
});

// --- AS24: blue header band, line table, totals box --------------------------------------------

function as24(doc: InvoiceDocument): Node[] {
  const s = styleOf(doc, ['dmy', 'iso']);
  const blue = '#0b4ea2';
  const date = formatDate(doc.refuelDate, s.dateFormat);
  const columns = s.rng.pick([
    ['date', 'product', 'qty', 'price', 'amount'],
    ['product', 'date', 'qty', 'price', 'amount'],
  ] as const);
  const headers = {
    date: s.word('Date / time', 'Transaction'),
    product: s.word('Product', 'Fuel'),
    qty: s.word('Quantity (L)', 'Volume (L)'),
    price: s.word('Unit price incl. VAT (€/L)', 'Price/L incl. VAT'),
    amount: s.word('Amount incl. VAT (€)', 'Total incl. VAT'),
  };
  const cells = {
    date: `${date} ${doc.refuelTime}`,
    product: doc.product,
    qty: formatNumber(doc.liters, 2),
    price: formatNumber(doc.unitPriceEur, 3),
    amount: formatNumber(doc.totalEur, 2),
  };
  return [
    {
      table: {
        widths: ['*', 'auto'],
        body: [
          [
            { stack: [{ text: 'AS24', fontSize: 28, bold: true, color: 'white' }, ...doc.issuer.lines.map((l) => ({ text: l, color: 'white', fontSize: 8 }))] },
            {
              stack: [
                { text: s.word('INVOICE', 'FUEL INVOICE', 'Invoice – fuel card'), bold: true, color: 'white', fontSize: 14, alignment: 'right' },
                { text: `No. ${doc.invoiceNumber}`, color: 'white', alignment: 'right' },
                { text: `${s.word('Date', 'Issue date')}: ${formatDate(doc.issuedAt, s.dateFormat)}`, color: 'white', alignment: 'right' },
              ],
            },
          ],
        ],
      },
      layout: { fillColor: blue, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 10, paddingBottom: () => 10 },
    },
    {
      columns: [
        {
          stack: [
            { text: s.word('Customer', 'Billed to'), bold: true, color: blue },
            doc.carrier,
            `${s.word('Card', 'Fuel card')}: ${doc.cardNumber}`,
            `${s.word('Vehicle', 'Registration')}: ${doc.plate}`,
          ],
        },
        {
          stack: [
            { text: s.word('Station', 'Point of sale'), bold: true, color: blue },
            doc.station.name,
            doc.station.street,
            `${doc.station.postcode} ${doc.station.city}`,
          ],
        },
      ],
      margin: [0, 16, 0, 16],
    },
    {
      table: {
        headerRows: 1,
        widths: columns.map((c) => (c === 'product' ? '*' : 'auto')),
        body: [
          columns.map((c) => ({ text: headers[c], bold: true, color: 'white', fillColor: blue, fontSize: 9 })),
          columns.map((c) => ({ text: cells[c], alignment: c === 'qty' || c === 'price' || c === 'amount' ? 'right' : 'left' })),
        ],
      },
      layout: 'lightHorizontalLines',
    },
    {
      columns: [
        { text: '', width: '*' },
        {
          width: 220,
          table: {
            widths: ['*', 'auto'],
            body: [
              [s.word('Total excl. VAT', 'Net amount'), formatNumber(doc.netEur, 2) + ' €'],
              ['VAT 20%', formatNumber(doc.vatEur, 2) + ' €'],
              [{ text: s.word('TOTAL INCL. VAT', 'Amount due incl. VAT'), bold: true }, { text: formatNumber(doc.totalEur, 2) + ' €', bold: true }],
            ],
          },
        },
      ],
      margin: [0, 14, 0, 0],
    },
    ...smallPrint(doc, [
      `VAT ${doc.issuer.vatId}`,
      ...s.notices(
        [
          'Payment by direct debit at 30 days.',
          'Invoice issued for a fuel card transaction.',
          'No discount for early payment.',
          'Late payment penalties: 3 × the legal interest rate.',
          'Keep this invoice for your VAT recovery.',
        ],
        2,
      ),
    ]),
  ];
}

// --- TotalEnergies: red accent, receipt-style key / value list --------------------------------

function totalEnergies(doc: InvoiceDocument): Node[] {
  const s = styleOf(doc, ['dmy', 'iso']);
  const red = '#d5001c';
  const rows: [string, string][] = [
    [s.word('Invoice no.', 'Invoice number', 'Document no.'), doc.invoiceNumber],
    [s.word('Issued on', 'Invoice date'), formatDate(doc.issuedAt, s.dateFormat)],
    [s.word('Service station', 'Station'), doc.station.name],
    [s.word('Address', 'Location'), `${doc.station.street}, ${doc.station.postcode} ${doc.station.city}`],
    [s.word('Pump date and time', 'Delivery'), `${formatDate(doc.refuelDate, s.dateFormat)} ${s.word('at', '-')} ${doc.refuelTime}`],
    [s.word('Vehicle registration', 'Plate'), doc.plate],
    [s.word('Card', 'Fleet card'), doc.cardNumber],
    [s.word('Product', 'Fuel'), doc.product],
    [s.word('Volume delivered', 'Quantity'), `${formatNumber(doc.liters, 2)} L`],
    [s.word('Price per litre incl. VAT', 'Unit price incl. VAT'), `${formatNumber(doc.unitPriceEur, 3)} €/L`],
    [s.word('Amount excl. VAT', 'Net amount'), `${formatNumber(doc.netEur, 2)} €`],
    ['VAT (20%)', `${formatNumber(doc.vatEur, 2)} €`],
  ];
  if (s.rng.next() < 0.5) rows.splice(5, 2, rows[6], rows[5]);
  return [
    {
      columns: [
        { text: [{ text: 'Total', color: red }, { text: 'Energies', color: '#333333' }], fontSize: 24, bold: true },
        { stack: doc.issuer.lines, alignment: 'right', fontSize: 8, color: '#555555' },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 2, lineColor: red }] },
    { text: s.word('Invoice receipt', 'Fuel invoice', 'Delivery invoice'), fontSize: 15, bold: true, margin: [0, 12, 0, 4] },
    { text: `${s.word('Customer', 'Account')}: ${doc.carrier}`, margin: [0, 0, 0, 10] },
    keyValues(rows),
    {
      table: {
        widths: ['*', 'auto'],
        body: [
          [
            { text: s.word('TOTAL TO PAY INCL. VAT', 'Total incl. VAT'), bold: true, color: 'white' },
            { text: `${formatNumber(doc.totalEur, 2)} €`, bold: true, color: 'white', fontSize: 13 },
          ],
        ],
      },
      layout: { fillColor: red, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
      margin: [0, 12, 0, 0],
    },
    ...smallPrint(doc, [
      `VAT no. ${doc.issuer.vatId}`,
      ...s.notices(
        [
          'Thank you for your visit.',
          'Amount debited from your fleet card account.',
          'This receipt is worth an invoice.',
          'Prices include all taxes (TICPE included).',
        ],
        2,
      ),
    ]),
  ];
}

// --- DKV: multi-line statement in small type ---------------------------------------------------

function dkv(doc: InvoiceDocument): Node[] {
  const s = styleOf(doc, ['dmy-dot', 'iso']);
  const date = formatDate(doc.refuelDate, s.dateFormat);
  const header = [
    'Date',
    s.word('Time', 'Hour'),
    s.word('Station', 'Acceptance point'),
    s.word('City', 'Town'),
    'Product',
    s.word('Qty (L)', 'Litres'),
    s.word('Price/L incl. VAT', 'Unit price incl. VAT'),
    s.word('Net €', 'Excl. VAT €'),
    'VAT €',
    s.word('Gross €', 'Incl. VAT €'),
  ];
  const line = [
    date,
    doc.refuelTime,
    doc.station.name,
    doc.station.city,
    doc.product,
    formatNumber(doc.liters, 2),
    formatNumber(doc.unitPriceEur, 3),
    formatNumber(doc.netEur, 2),
    formatNumber(doc.vatEur, 2),
    formatNumber(doc.totalEur, 2),
  ];
  const right = (index: number) => (index >= 5 ? 'right' : 'left');
  // Station and city on one line each (no hyphenation inside the place names)
  const noWrap = (index: number) => index === 3;
  return [
    {
      columns: [
        { text: 'DKV', fontSize: 26, bold: true, color: '#003a70' },
        { stack: doc.issuer.lines, alignment: 'right', fontSize: 8 },
      ],
    },
    { text: s.word('Fuel card statement', 'Transaction statement'), fontSize: 13, bold: true, margin: [0, 10, 0, 6] },
    keyValues(
      [
        [s.word('Statement no.', 'Document no.'), doc.invoiceNumber],
        [s.word('Statement date', 'Date of issue'), formatDate(doc.issuedAt, s.dateFormat)],
        [s.word('Customer', 'Account holder'), doc.carrier],
        [s.word('Card', 'Card number'), doc.cardNumber],
        [s.word('Vehicle', 'Licence plate'), doc.plate],
        [s.word('Acceptance point', 'Station'), `${doc.station.name}, ${doc.station.postcode} ${doc.station.city}`],
      ],
      { fontSize: 9 },
    ),
    {
      table: {
        headerRows: 1,
        widths: ['auto', 'auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
        body: [
          header.map((text, i) => ({ text, bold: true, fillColor: '#ffd200', alignment: right(i) })),
          line.map((text, i) => ({ text, alignment: right(i), noWrap: noWrap(i) })),
          [
            { text: s.word('Sub-total fuel', 'Fuel sub-total'), colSpan: 7, italics: true },
            '', '', '', '', '', '',
            { text: formatNumber(doc.netEur, 2), alignment: 'right', italics: true },
            { text: formatNumber(doc.vatEur, 2), alignment: 'right', italics: true },
            { text: formatNumber(doc.totalEur, 2), alignment: 'right', italics: true },
          ],
          [
            { text: s.word('Card service fees', 'Service charges'), colSpan: 7 },
            '', '', '', '', '', '',
            { text: '0.00', alignment: 'right' },
            { text: '0.00', alignment: 'right' },
            { text: '0.00', alignment: 'right' },
          ],
          [
            { text: s.word('Statement total (EUR)', 'Total amount (EUR)'), colSpan: 7, bold: true },
            '', '', '', '', '', '',
            { text: formatNumber(doc.netEur, 2), alignment: 'right', bold: true },
            { text: formatNumber(doc.vatEur, 2), alignment: 'right', bold: true },
            { text: formatNumber(doc.totalEur, 2), alignment: 'right', bold: true },
          ],
        ],
      },
      fontSize: 7.5,
      margin: [0, 12, 0, 0],
    },
    ...smallPrint(doc, [
      `VAT ID ${doc.issuer.vatId}`,
      ...s.notices(
        [
          'Amounts in EUR. Collected by SEPA direct debit.',
          'Please check this statement and report any discrepancy within 30 days.',
          'VAT 20% charged by the station operator.',
          'Statement issued per transaction.',
        ],
        2,
      ),
    ]),
  ];
}

// --- Independent station: typed letter, monospace font -----------------------------------------

function independent(doc: InvoiceDocument): Node[] {
  const s = styleOf(doc, ['dmy', 'iso']);
  const comma = doc.messy;
  const n = (value: number, decimals: number) => formatNumber(value, decimals, comma);
  const plate = doc.messy ? doc.plate.replaceAll('-', '') : doc.plate;
  const time = doc.messy ? doc.refuelTime.replace(':', 'h') : doc.refuelTime;
  const pad = (label: string) => label.padEnd(26, '.') + ' ';
  const lines = [
    `${pad(s.word('Vehicle', 'Truck reg.'))}${plate}`,
    `${pad(s.word('Customer', 'Client'))}${doc.carrier}`,
    `${pad(s.word('Delivery', 'Filled on'))}${formatDate(doc.refuelDate, s.dateFormat)} ${time}`,
    `${pad('Product')}${doc.product}`,
    `${pad(s.word('Litres', 'Quantity'))}${n(doc.liters, 2)} L`,
    ...(doc.messy ? [`${pad('Unit price excl. VAT')}${n(doc.unitPriceExVatEur, 4)} EUR/L`] : []),
    `${pad('Unit price incl. VAT')}${n(doc.unitPriceEur, 3)} EUR/L`,
    '',
    `${pad('Total excl. VAT')}${n(doc.netEur, 2)} EUR`,
    `${pad('VAT 20 %')}${n(doc.vatEur, 2)} EUR`,
    `${pad(doc.messy ? 'TOTAL incl. VAT (TTC)' : 'TOTAL incl. VAT')}${n(doc.totalEur, 2)} EUR`,
  ];
  return [
    { stack: doc.issuer.lines.map((l, i) => ({ text: l, bold: i === 0, fontSize: i === 0 ? 14 : 9, lineHeight: 1.3 })), font: 'Courier' },
    { text: `${doc.station.name} – ${doc.station.street}, ${doc.station.postcode} ${doc.station.city}`, font: 'Courier', fontSize: 8, margin: [0, 2, 0, 0] },
    {
      text: `${s.word('INVOICE', 'Invoice')} ${doc.invoiceNumber.startsWith('N°') ? doc.invoiceNumber : `No. ${doc.invoiceNumber}`}   ${s.word('of', 'dated')} ${formatDate(doc.issuedAt, s.dateFormat)}`,
      font: 'Courier',
      bold: true,
      margin: [0, 24, 0, 12],
    },
    { stack: lines.map((l) => ({ text: l || ' ', preserveLeadingSpaces: true })), font: 'Courier', fontSize: 10, lineHeight: 1.35 },
    {
      text: s.word('Paid by card – thank you!', 'Paid at the counter. Thank you for your trust.'),
      font: 'Courier',
      italics: true,
      margin: [0, 18, 0, 0],
    },
    ...smallPrint(doc, [`VAT ${doc.issuer.vatId}`, 'Independent fuel station – open 6am-9pm']),
  ];
}

const TEMPLATES: Record<InvoiceTemplate, (doc: InvoiceDocument) => Node[]> = {
  as24,
  totalenergies: totalEnergies,
  dkv,
  independent,
};

/** Renders an invoice as a text PDF. */
export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Buffer> {
  const definition = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: doc.template === 'independent' ? 'Courier' : 'Helvetica', fontSize: 10 },
    info: {
      title: `${doc.supplier} ${doc.invoiceNumber}`,
      author: doc.supplier,
      creationDate: new Date(`${doc.issuedAt}T12:00:00Z`),
    },
    content: TEMPLATES[doc.template](doc),
  };
  return pdfmake.createPdf(definition).getBuffer();
}

/** Renders every invoice of the plan: file name → PDF. */
export async function renderInvoices(
  plans: readonly { file: string; document: InvoiceDocument }[],
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const plan of plans) files.set(plan.file, await renderInvoicePdf(plan.document));
  return files;
}
