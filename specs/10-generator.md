# 10 — Invoice documents (simulator, V2)

The PDF invoices are produced **by the simulator, in code, without a model**, at every "Start" (decided in M8). The dataset is recomputed on every "Start" with D = today's date (spec 04), so the refuel dates and instants change from one simulation to the next: frozen, versioned PDFs could not carry the right dates. The former offline `generator` CLI (`apps/generator`, Ollama dressing up the layouts) is dropped.

Principle: **code sets the facts and the form.** The figures (liters, prices, amounts, dates, number plates) come from the simulated refuels; the form comes from four hard-coded supplier templates, with variations drawn at each start.

## Where
| Module (`apps/simulator/src`) | Role |
|---|---|
| `billing.ts` | billing scenarios B1, B3, B4 (truck, day, time, station, liters, overbilling, injection, messy format), number of B2 invoices |
| `invoices.ts` | invoices plan: facts of each invoice (`InvoiceDocument`), expected extraction values (`InvoiceExtraction`, spec 02), sending instant |
| `invoice-pdf.ts` | PDF rendering with **pdfmake** (standard PDF fonts Helvetica / Courier: text PDF, no font file, no network or disk access) |

- `generate()` computes the plan (pure, deterministic: same seed and same start instant → same plan, same wording).
- At `start`, after `dataset.json`, the simulator renders the PDFs into its volume (`/data/live-invoices/*.pdf`); they are sent during the replay (spec 04, from M9/M10).
- `simulator generate --out data/generated` also writes `invoices-plan.json` and `live-invoices/*.pdf` + `live-invoices/manifest.json` (expected values, copy of the ground truth), to look at the documents.

## Invoices
1. For each planned invoice, the code assembles the **facts**: supplier, station and its fictional address, refuel date and time, carrier, number plate, masked card number, product (according to the truck's energy), billed liters (delivered + 162 L for B1), unit price including VAT (that of the card transaction), amounts excluding VAT / 20% VAT / including VAT.
2. The template depends on the station's brand: **AS24** (blue header band, line table, totals box), **TotalEnergies** (receipt with a key / value list, red total band), **DKV** (multi-line statement in small type: transaction line, fuel sub-total, service fees, total), **independent station** (typed letter in a monospace font).
3. **Variations at each start** (drawn from the seed, the start instant and the invoice id): invoice number format, title and label synonyms, date format (`DD/MM/YYYY`, `DD.MM.YYYY` or ISO), column or row order, footer notices, product wording. They never change a figure.
4. Special cases:
   - **B3**: the injection sentence (`B3_INJECTION`, it matches the API patterns "ignore … instructions") is printed in very small light-grey type in the footer;
   - **B4**: decimal commas, unit prices and amounts excluding and including VAT, number plate without dashes, date in the "14 Oct 2026" format, time as "17h05".
5. Every invoice carries a small "simulated document – fictional company and data" notice; the issuers' identifiers are deliberately invalid.

The text must be **extractable**: the tests re-read each PDF with **unpdf** (the library the API will use in M9).

## Driver messages
The rewriting of the template messages by a model is dropped with the generator: the messages stay the templates of spec 04. (Idea: enrich the templates with variants drawn at each start.)

## Acceptance criteria
1. Each rendered PDF is readable and its extracted text contains the billed liters and total, the plate, the invoice number and the station's city.
2. The 4 templates are visually different.
3. The injection sentence only appears in invoice B3.
4. Another start (other style key) changes the form, never the figures; the same seed and start instant give the same documents.
