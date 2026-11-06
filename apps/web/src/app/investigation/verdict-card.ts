import { Component, computed, input, output } from '@angular/core';
import type { AlertDetail, Verdict } from '@fleet/contracts';
import { fmtPercent } from '../core/format';
import { CATEGORY_LABELS, decisionReason } from '../core/labels';

@Component({
  selector: 'app-verdict-card',
  template: `
    <section class="card" [attr.data-category]="verdict().category">
      <div class="top">
        <div>
          <span class="k">Verdict de l’agent</span>
          <h2>{{ categoryLabel() }}</h2>
        </div>
        <div class="confidence">
          <span class="value">{{ confidence() }}</span>
          <div
            class="bar"
            role="meter"
            aria-label="Confiance"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-valuenow]="percent()"
          >
            <div class="fill" [style.width.%]="percent()"></div>
          </div>
        </div>
      </div>

      <p class="summary">{{ verdict().summary }}</p>

      <h3>Preuves</h3>
      <ul class="evidence">
        @for (e of verdict().evidence; track $index) {
          <li>
            <button
              type="button"
              (click)="evidenceClick.emit(e.toolCallId)"
              title="Voir l’étape citée"
            >
              <span class="ref">{{ e.toolCallId }}</span>
              <span>{{ e.finding }}</span>
            </button>
          </li>
        }
      </ul>

      @if (alert().decision; as decision) {
        <div class="decision" [attr.data-decision]="decision">
          <strong>{{
            decision === 'auto_closed' ? 'Classée automatiquement' : 'Escaladée à un analyste'
          }}</strong>
          @if (reason(); as r) {
            <span>— {{ r }}</span>
          }
        </div>
      }
    </section>
  `,
  styleUrl: './verdict-card.css',
})
export class VerdictCard {
  readonly verdict = input.required<Verdict>();
  readonly alert = input.required<AlertDetail>();
  readonly evidenceClick = output<string>();

  protected readonly categoryLabel = computed(() => CATEGORY_LABELS[this.verdict().category]);
  protected readonly percent = computed(() => Math.round(this.verdict().confidence * 100));
  protected readonly confidence = computed(() => fmtPercent(this.verdict().confidence));
  protected readonly reason = computed(() => decisionReason(this.alert()));
}
