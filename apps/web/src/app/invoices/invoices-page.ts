import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import type { InvoiceDetail, InvoiceListItem } from '@fleet/contracts';
import { filter, map, of, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtDateTime, fmtEuros, fmtLiters, fmtNumber, fmtUnitPrice } from '../core/format';
import { t } from '../core/i18n/i18n';
import { invoiceStatusLabel, invoiceStatusTone } from '../core/labels';
import { POLL_INTERVAL_MS, poll } from '../core/polling';

/** "Invoices" tab (V2): received PDFs, what the extractor read, what the code reconciled. */
@Component({
  selector: 'app-invoices-page',
  template: `
    <aside class="list">
      <div class="list-head">
        <h2>{{ t('invoices.title') }}</h2>
        <span class="muted">{{ t('invoices.count', { n: invoices()?.length ?? 0 }) }}</span>
      </div>
      @if (failed()) {
        <p class="error">{{ t('invoices.unreachable') }}</p>
      }
      @if (invoices(); as list) {
        @if (list.length === 0) {
          <p class="muted empty">{{ t('invoices.none') }}</p>
        }
        <ul>
          @for (invoice of list; track invoice.id) {
            <li>
              <button
                type="button"
                class="item"
                [class.selected]="invoice.id === selectedId()"
                (click)="select(invoice.id)"
              >
                <div class="row">
                  <strong>{{ invoice.supplier ?? invoice.originalFilename ?? '—' }}</strong>
                  <span class="pill" [attr.data-tone]="tone(invoice.status)">{{
                    statusLabel(invoice.status)
                  }}</span>
                </div>
                <div class="row muted">
                  <span class="mono">{{ invoice.plate ?? '—' }}</span>
                  <span>{{ fmtDateTime(invoice.refuelAt ?? invoice.receivedAt) }}</span>
                </div>
                <div class="row">
                  <span>{{ fmtLiters(invoice.liters) }} · {{ fmtEuros(invoice.totalEur) }}</span>
                  @if (invoice.suspicious) {
                    <span class="badge">{{ t('invoices.suspicious') }}</span>
                  }
                </div>
              </button>
            </li>
          }
        </ul>
      }
    </aside>

    @if (detail(); as invoice) {
      <section class="pdf">
        <iframe [src]="pdfUrl()" [title]="t('invoices.pdfTitle')"></iframe>
      </section>

      <section class="fields">
        <div class="title">
          <h1>{{ invoice.extraction?.supplier ?? invoice.originalFilename }}</h1>
          <span class="pill" [attr.data-tone]="tone(invoice.status)">{{
            statusLabel(invoice.status)
          }}</span>
        </div>

        @if (invoice.suspicious) {
          <div class="suspicious">
            <strong>⚠ {{ t('invoices.suspicious') }}</strong>
            <p>{{ t('invoices.suspiciousText') }}</p>
            @if (invoice.suspiciousExcerpt) {
              <mark>{{ invoice.suspiciousExcerpt }}</mark>
            }
          </div>
        }

        @if (invoice.alert; as alert) {
          <button type="button" class="alert-link" (click)="openAlert(alert.id)">
            {{ t('invoices.openAlert') }} →
          </button>
        }

        <h3>{{ t('invoices.reconciliation') }}</h3>
        @if (invoice.reconciliation; as r) {
          @if (r.reason) {
            <p class="reason">{{ r.reason }}</p>
          } @else {
            <div class="figures">
              <div>
                <span class="k">{{ t('invoices.billed') }}</span>
                <span class="big">{{ fmtLiters(r.billedL) }}</span>
              </div>
              <div>
                <span class="k">{{ t('invoices.observedRise') }}</span>
                <span class="big">{{ fmtLiters(r.observedRiseL) }}</span>
              </div>
              <div [class.bad]="isGapTooLarge(r.gapL, r.toleranceL)">
                <span class="k">{{ t('invoices.gap') }}</span>
                <span class="big">{{ fmtSigned(r.gapL) }}</span>
                <span class="muted small">{{
                  t('invoices.tolerance', { liters: fmtLiters(r.toleranceL) })
                }}</span>
              </div>
            </div>
            <dl>
              <dt>{{ t('invoices.station') }}</dt>
              <dd [class.bad]="!r.stationMatched">
                {{ r.stationMatched ? r.stationName : t('invoices.noStationStop') }}
              </dd>
              @if (r.cardLiters) {
                <dt>{{ t('invoices.cardTransaction') }}</dt>
                <dd>{{ fmtLiters(r.cardLiters) }}</dd>
              }
              <dt>{{ t('invoices.attachedTo') }}</dt>
              <dd>
                {{
                  r.refuelSource === 'fuel_card'
                    ? t('invoices.attachedCard')
                    : r.refuelSource === 'invoice'
                      ? t('invoices.attachedCreated')
                      : '—'
                }}
              </dd>
            </dl>
          }
        } @else {
          <p class="muted">{{ t('invoices.pending') }}</p>
        }

        <h3>{{ t('invoices.extracted') }}</h3>
        @if (invoice.extraction; as e) {
          <dl>
            <dt>{{ t('invoices.field.invoiceNumber') }}</dt>
            <dd class="mono">{{ e.invoiceNumber ?? '—' }}</dd>
            <dt>{{ t('invoices.field.refuelAt') }}</dt>
            <dd>{{ e.refuelAt ? fmtDateTime(e.refuelAt) : '—' }}</dd>
            <dt>{{ t('invoices.field.station') }}</dt>
            <dd>{{ e.stationName ?? '—' }}{{ e.stationCity ? ' · ' + e.stationCity : '' }}</dd>
            <dt>{{ t('invoices.field.plate') }}</dt>
            <dd class="mono">{{ e.plate ?? '—' }}</dd>
            <dt>{{ t('invoices.field.fuel') }}</dt>
            <dd>{{ e.fuelType ?? '—' }}</dd>
            <dt>{{ t('invoices.field.liters') }}</dt>
            <dd>{{ fmtLiters(e.liters) }}</dd>
            <dt>{{ t('invoices.field.unitPrice') }}</dt>
            <dd>{{ fmtUnitPrice(e.unitPriceEur) }}</dd>
            <dt>{{ t('invoices.field.total') }}</dt>
            <dd>{{ fmtEuros(e.totalEur) }}</dd>
            @if (e.confidenceNotes) {
              <dt>{{ t('invoices.field.notes') }}</dt>
              <dd class="muted">{{ e.confidenceNotes }}</dd>
            }
          </dl>
        } @else if (invoice.status === 'failed') {
          <p class="reason">{{ t('invoices.noText') }}</p>
        } @else {
          <p class="muted"><span class="spinner"></span>{{ t('invoices.reading') }}</p>
        }
      </section>
    } @else {
      <p class="placeholder">{{ t(selectedId() ? 'invoices.loading' : 'invoices.select') }}</p>
    }
  `,
  styles: `
    :host {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 300px minmax(0, 1.1fr) minmax(340px, 1fr);
      background: var(--bg);
    }
    .list {
      border-right: 1px solid var(--border);
      background: var(--surface);
      overflow-y: auto;
    }
    .list-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 14px 16px 8px;
    }
    h2 {
      margin: 0;
      font-size: 18px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0 8px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .item {
      width: 100%;
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      font: inherit;
      font-size: 14px;
      cursor: pointer;
    }
    .item.selected {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .muted {
      color: var(--muted);
    }
    .small {
      font-size: 13px;
    }
    .mono {
      font-family: var(--mono);
    }
    .empty,
    .error {
      padding: 0 16px;
    }
    .error {
      color: var(--red);
    }
    .pill {
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      color: var(--c);
      background: color-mix(in srgb, var(--c) 12%, transparent);
      --c: var(--muted);
    }
    [data-tone='progress'] {
      --c: var(--accent);
    }
    [data-tone='ok'] {
      --c: var(--green);
    }
    [data-tone='warn'] {
      --c: var(--orange);
    }
    [data-tone='bad'] {
      --c: var(--red);
    }
    .badge {
      padding: 1px 8px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      background: var(--red);
    }
    .pdf {
      padding: 16px;
      min-height: 0;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #fff;
    }
    .fields {
      padding: 16px 20px 32px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
    }
    h3 {
      margin: 8px 0 0;
      font-size: 15px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .suspicious {
      border: 2px solid var(--red);
      border-radius: 10px;
      padding: 10px 14px;
      background: color-mix(in srgb, var(--red) 6%, transparent);
      color: var(--red);
    }
    .suspicious p {
      margin: 4px 0 8px;
      color: var(--text);
      font-size: 14px;
    }
    mark {
      display: block;
      padding: 6px 8px;
      border-radius: 6px;
      background: #fde68a;
      color: var(--text);
      font-family: var(--mono);
      font-size: 13px;
    }
    .alert-link {
      align-self: flex-start;
      padding: 8px 14px;
      border: none;
      border-radius: 8px;
      background: var(--orange);
      color: #fff;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .figures {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .figures > div {
      display: flex;
      flex-direction: column;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
    }
    .k {
      color: var(--muted);
      font-size: 13px;
    }
    .big {
      font-size: 22px;
      font-weight: 700;
    }
    .bad {
      color: var(--red);
    }
    .figures > .bad {
      border-color: var(--red);
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 16px;
      margin: 0;
      font-size: 15px;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
    }
    .reason {
      margin: 0;
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--orange) 10%, transparent);
    }
    .placeholder {
      grid-column: 2 / 4;
      align-self: center;
      justify-self: center;
      color: var(--muted);
    }
    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      margin-right: 8px;
      border: 2px solid var(--accent);
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class InvoicesPage {
  private readonly api = inject(ApiService);
  private readonly store = inject(ControlRoomStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly document = inject(DOCUMENT);

  protected readonly t = t;
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtEuros = fmtEuros;
  protected readonly fmtUnitPrice = fmtUnitPrice;
  protected readonly statusLabel = invoiceStatusLabel;
  protected readonly tone = invoiceStatusTone;

  private readonly lastList = signal<InvoiceListItem[] | null>(null);
  protected readonly invoices = this.lastList.asReadonly();
  protected readonly failed = signal(false);

  /** Selection carried by the URL (`/invoices?id=…`): links from an investigation open it. */
  private readonly requestedId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('id'))),
    { initialValue: null },
  );

  /** Requested invoice, otherwise the most recent one. */
  protected readonly selectedId = computed(
    () => this.requestedId() ?? this.invoices()?.[0]?.id ?? null,
  );

  private readonly detailState = toSignal(
    toObservable(this.selectedId).pipe(
      switchMap((id) =>
        id
          ? poll(() => this.api.invoice(id), POLL_INTERVAL_MS, this.document).pipe(
              filter((r) => r.ok),
              map((r) => r.value),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  protected readonly detail = computed<InvoiceDetail | null>(() => {
    const detail = this.detailState();
    return detail && detail.id === this.selectedId() ? detail : null;
  });

  /** Recomputed only when the selection changes: the iframe does not reload at every poll. */
  protected readonly pdfUrl = computed(() => {
    const id = this.selectedId();
    return id ? this.sanitizer.bypassSecurityTrustResourceUrl(this.api.invoiceFileUrl(id)) : null;
  });

  constructor() {
    // Polling only while the tab is open
    poll(() => this.api.invoices())
      .pipe(takeUntilDestroyed())
      .subscribe((r) => {
        this.failed.set(!r.ok);
        if (r.ok) this.lastList.set(r.value);
      });
  }

  protected select(id: string) {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { id } });
  }

  protected openAlert(alertId: string) {
    this.store.select(alertId);
    void this.router.navigate(['/']);
  }

  protected isGapTooLarge(gap: number | null, tolerance: number | null) {
    return gap !== null && tolerance !== null && gap > tolerance;
  }

  protected fmtSigned(liters: number | null) {
    if (liters === null) return '—';
    return `${liters > 0 ? '+' : ''}${fmtNumber(liters, true)} L`;
  }
}
