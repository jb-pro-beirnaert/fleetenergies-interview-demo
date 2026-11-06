# 10 — Document generator (`apps/generator`, V2)

CLI run **once, offline**, to produce realistic and varied documents. Its outputs are **versioned in the repo**: the demo and the tests never depend on a new generation.

> **To be decided in M8**: the simulator dataset is now recomputed on every "Start" with D = today's date (spec 04), so the refuel dates and instants change from one simulation to the next. Versioned PDFs can no longer carry frozen dates: either the code produces them at `start` by injecting the day's facts into a versioned layout (the model only intervenes once, offline), or the invoices are generated at each simulation without a model. The figures are always set by the code.

Principle: **code sets the facts, the model dresses them up.** The figures (liters, prices, amounts, dates, number plates) always come from the simulator files; the model only produces the form (labels, legal notices, wording).

## Commands
| Command | Effect |
|---|---|
| `generator invoices` | reads `invoices-plan.json`, `live-refuels.json`, `reference.json` (produced by `simulator generate --out`, or by calling `generate()` directly); writes `data/generated/live-invoices/*.pdf` and `live-invoices/manifest.json` |
| `generator messages` | rewrites the messages of `live-messages.json` in natural language; writes `live-messages.json` (the original is kept in `live-messages.templates.json`) |

## Invoices
1. For each planned invoice, the code assembles the **facts**: supplier, station, fictional address, date and time, number plate, fuel, billed liters (different from the actual liters for B1), unit price, amounts excluding VAT / 20% VAT / including VAT.
2. The model receives these facts and a **supplier style** (4 templates: AS24, TotalEnergies, multi-line DKV statement, independent station) and returns a **layout** JSON: invoice number in the supplier's format, line labels, footer notices, header wording. Structured output validated by Zod.
3. The code renders the PDF (library to be proposed, for example `pdfkit`) with a layout specific to each template. **The code re-injects the figures**: the model never touches them.
4. Special cases, produced by the code:
   - **B3**: addition, in small print in the footer, of the injection sentence planned in `invoices-plan.json`;
   - **B4**: decimal commas, amounts excluding and including VAT, number plate without dashes, date in the "14 Oct 2026" format.
5. `manifest.json`: file, planned invoice, exact expected values (copied into `ground-truth.json`).

The text must be **extractable** (text PDF, not an image): check each generated PDF by re-reading its text with the same library as the API.

## Driver messages
- The model rewrites each template message ("arrived at the customer") in a natural driver style: short, sometimes without punctuation, common abbreviations, without changing the meaning.
- The scenario messages keep their **key facts**, checked in code after generation: for S4, the mechanic's name and phone number must be present as is (they are used to demonstrate masking); for S2, the mention of the gauge; for S3, that of the reefer unit. If the check fails, new generation (3 tries), then the original message is kept.

## Acceptance criteria
1. Each PDF in `live-invoices/` is readable and its extracted text contains the expected liters and total.
2. The 4 templates are visually different.
3. The injection sentence only appears in invoice B3.
4. Re-running `generator` changes no figure (only the form).
5. The key facts of the scenario messages are present after rewriting.
