import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtDateTime, fmtDuration, fmtLiters, fmtMs, fmtTime } from '../core/format';
import { t } from '../core/i18n/i18n';
import { alertTypeLabel } from '../core/labels';
import { StatusPill } from '../core/status-pill';
import { buildTrace, stepAnchor, traceTimes } from '../core/trace';
import { ReviewForm } from './review-form';
import { TraceStep } from './trace-step';
import { VerdictCard } from './verdict-card';

@Component({
  selector: 'app-investigation-panel',
  imports: [StatusPill, TraceStep, VerdictCard, ReviewForm, RouterLink],
  template: `
    @if (store.detail(); as alert) {
      <section class="head card">
        <div class="title">
          <h1>{{ alert.truck.plate }}</h1>
          <app-status-pill [status]="alert.status" />
        </div>
        <div class="facts">
          <div>
            <span class="k">{{ t('inv.type') }}</span>
            <span>{{ alertTypeLabel(alert.type) }}</span>
          </div>
          <div>
            <span class="k">{{ t('inv.window') }}</span>
            <span>{{ fmtDateTime(alert.windowStart) }} → {{ fmtTime(alert.windowEnd) }}</span>
          </div>
          <div>
            <span class="k">{{
              t(alert.type === 'billing_mismatch' ? 'inv.billingGap' : 'inv.drop')
            }}</span>
            <span class="big">{{ fmtLiters(alert.dropL) }}</span>
          </div>
          <div>
            <span class="k">{{ t('inv.truck') }}</span>
            <span>{{ alert.truck.make }} {{ alert.truck.model }} · {{ alert.truck.carrier }}</span>
          </div>
          <div>
            <span class="k">{{ t('inv.duration') }}</span>
            <span>{{ duration() }}</span>
          </div>
          <div>
            <span class="k">{{ t('inv.toolCalls') }}</span>
            <span>{{ toolCalls() }}</span>
          </div>
          <div>
            <span class="k">{{ t('inv.timeSplit') }}</span>
            <span>{{ timeSplit() }}</span>
          </div>
        </div>
        @if (invoiceId(); as invoiceId) {
          <a class="invoice-link" routerLink="/invoices" [queryParams]="{ id: invoiceId }">
            {{ t('inv.openInvoice') }} →
          </a>
        }
      </section>

      <section class="trace">
        <h2>{{ t('inv.traceTitle') }}</h2>
        @if (!alert.investigation) {
          <p class="muted">{{ t('inv.waiting') }}</p>
        }
        @for (attempt of trace(); track attempt.attempt) {
          @if (trace().length > 1) {
            <h3 class="attempt">{{ t('inv.attempt', { n: attempt.attempt }) }}</h3>
          }
          <ol>
            @for (item of attempt.items; track item.id) {
              <li>
                <app-trace-step
                  [item]="item"
                  [alert]="alert"
                  [anchor]="
                    item.kind === 'tool' && item.ref ? anchor(item.attempt, item.ref) : null
                  "
                />
              </li>
            }
          </ol>
        }
        @if (running()) {
          <p class="running"><span class="spinner"></span>{{ t('inv.running') }}</p>
        }
      </section>

      @if (alert.investigation?.verdict; as verdict) {
        <app-verdict-card
          [verdict]="verdict"
          [alert]="alert"
          (evidenceClick)="scrollToStep($event)"
        />
      } @else if (alert.investigation?.status === 'failed') {
        <section class="card failed">
          <strong>{{ t('inv.failedTitle') }}</strong> {{ t('inv.failedText') }}
        </section>
      }

      @if (alert.status === 'escalated' || alert.status === 'closed' || alert.review) {
        <app-review-form [alert]="alert" />
      }
    } @else if (store.selectedId()) {
      <p class="placeholder">{{ t('inv.loading') }}</p>
    } @else {
      <p class="placeholder">{{ t('inv.none') }}</p>
    }
  `,
  styleUrl: './investigation-panel.css',
})
export class InvestigationPanel {
  protected readonly store = inject(ControlRoomStore);
  protected readonly t = t;
  protected readonly alertTypeLabel = alertTypeLabel;
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly fmtTime = fmtTime;
  protected readonly fmtLiters = fmtLiters;
  protected readonly anchor = stepAnchor;

  /** V2: invoice behind a billing discrepancy alert */
  protected readonly invoiceId = computed(() => {
    const id = this.store.detail()?.details['invoiceId'];
    return typeof id === 'string' ? id : null;
  });

  protected readonly trace = computed(() =>
    buildTrace(this.store.detail()?.investigation?.steps ?? []),
  );

  protected readonly running = computed(() => {
    const alert = this.store.detail();
    return alert?.status === 'investigating' || alert?.investigation?.status === 'running';
  });

  protected readonly toolCalls = computed(() => {
    const investigation = this.store.detail()?.investigation;
    if (!investigation) return '—';
    // during the investigation, the API counter is only filled in at the verdict
    const live = this.trace().reduce(
      (n, a) => n + a.items.filter((i) => i.kind === 'tool').length,
      0,
    );
    return String(Math.max(investigation.toolCallsCount, live));
  });

  /** Where the time goes: the LLM turns versus the MCP tool calls */
  protected readonly timeSplit = computed(() => {
    const { modelMs, toolMs } = traceTimes(this.trace());
    return modelMs === 0 && toolMs === 0 ? '—' : `${fmtMs(modelMs)} / ${fmtMs(toolMs)}`;
  });

  protected readonly duration = computed(() => {
    const investigation = this.store.detail()?.investigation;
    if (!investigation) return '—';
    if (investigation.durationSeconds !== null) return fmtDuration(investigation.durationSeconds);
    if (investigation.startedAt && investigation.status === 'running') {
      return `${fmtDuration((Date.now() - Date.parse(investigation.startedAt)) / 1000)}…`;
    }
    return '—';
  });

  protected scrollToStep(ref: string) {
    const attempts = this.trace();
    const last = attempts.at(-1);
    if (!last) return;
    const element = document.getElementById(stepAnchor(last.attempt, ref));
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.remove('flash');
    // restart the highlight animation
    void element.offsetWidth;
    element.classList.add('flash');
  }
}
