import { Component, computed, inject } from '@angular/core';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtDateTime, fmtDuration, fmtLiters, fmtTime } from '../core/format';
import { ALERT_TYPE_LABELS } from '../core/labels';
import { StatusPill } from '../core/status-pill';
import { buildTrace, stepAnchor } from '../core/trace';
import { ReviewForm } from './review-form';
import { TraceStep } from './trace-step';
import { VerdictCard } from './verdict-card';

@Component({
  selector: 'app-investigation-panel',
  imports: [StatusPill, TraceStep, VerdictCard, ReviewForm],
  template: `
    @if (store.detail(); as alert) {
      <section class="head card">
        <div class="title">
          <h1>{{ alert.truck.plate }}</h1>
          <app-status-pill [status]="alert.status" />
        </div>
        <div class="facts">
          <div>
            <span class="k">Type</span>
            <span>{{ typeLabels[alert.type] }}</span>
          </div>
          <div>
            <span class="k">Fenêtre</span>
            <span>{{ fmtDateTime(alert.windowStart) }} → {{ fmtTime(alert.windowEnd) }}</span>
          </div>
          <div>
            <span class="k">Baisse</span>
            <span class="big">{{ fmtLiters(alert.dropL) }}</span>
          </div>
          <div>
            <span class="k">Camion</span>
            <span>{{ alert.truck.make }} {{ alert.truck.model }} · {{ alert.truck.carrier }}</span>
          </div>
          <div>
            <span class="k">Durée d’enquête</span>
            <span>{{ duration() }}</span>
          </div>
          <div>
            <span class="k">Appels d’outils</span>
            <span>{{ toolCalls() }}</span>
          </div>
        </div>
      </section>

      <section class="trace">
        <h2>Enquête de l’agent</h2>
        @if (!alert.investigation) {
          <p class="muted">En attente d’un agent enquêteur…</p>
        }
        @for (attempt of trace(); track attempt.attempt) {
          @if (trace().length > 1) {
            <h3 class="attempt">Tentative {{ attempt.attempt }}</h3>
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
          <p class="running"><span class="spinner"></span>Enquête en cours…</p>
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
          <strong>Enquête en échec</strong> — l’alerte est escaladée à un analyste.
        </section>
      }

      @if (alert.status === 'escalated' || alert.status === 'closed' || alert.review) {
        <app-review-form [alert]="alert" />
      }
    } @else if (store.selectedId()) {
      <p class="placeholder">Chargement de l’alerte…</p>
    } @else {
      <p class="placeholder">
        Aucune alerte sélectionnée. Les alertes apparaîtront ici dès que le détecteur en lèvera.
      </p>
    }
  `,
  styleUrl: './investigation-panel.css',
})
export class InvestigationPanel {
  protected readonly store = inject(ControlRoomStore);
  protected readonly typeLabels = ALERT_TYPE_LABELS;
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly fmtTime = fmtTime;
  protected readonly fmtLiters = fmtLiters;
  protected readonly anchor = stepAnchor;

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
    // pendant l'enquête, le compteur de l'API n'est renseigné qu'au verdict
    const live = this.trace().reduce(
      (n, a) => n + a.items.filter((i) => i.kind === 'tool').length,
      0,
    );
    return String(Math.max(investigation.toolCallsCount, live));
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
    // relance l'animation de surbrillance
    void element.offsetWidth;
    element.classList.add('flash');
  }
}
