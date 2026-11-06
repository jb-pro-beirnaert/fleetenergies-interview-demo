import { Component, computed, inject } from '@angular/core';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtDuration, fmtNumber, fmtPercent } from '../core/format';
import { CATEGORIES, CATEGORY_LABELS } from '../core/labels';

@Component({
  selector: 'app-value-panel',
  template: `
    <h2>Valeur</h2>
    @if (store.stats(); as s) {
      <section class="block without">
        <span class="label">Sans agents</span>
        <span class="hero">{{ s.ruleOnly.toReviewManually }}</span>
        <span>alertes à analyser à la main</span>
      </section>

      <section class="block with">
        <span class="label">Avec agents</span>
        <div class="grid">
          <div class="green">
            <span class="hero">{{ s.withAgents.autoClosed }}</span>
            <span>classées auto</span>
          </div>
          <div class="orange">
            <span class="hero">{{ s.withAgents.escalated }}</span>
            <span>escaladées</span>
          </div>
        </div>
        <span class="muted">{{ s.withAgents.pending }} en attente ou en cours</span>
      </section>

      <section class="block">
        <dl>
          <div>
            <dt>Temps moyen d’enquête</dt>
            <dd>{{ fmtDuration(s.investigations.avgDurationSeconds) }}</dd>
          </div>
          <div>
            <dt>Appels d’outils moyens</dt>
            <dd>{{ fmtNumber(s.investigations.avgToolCalls, true) }}</dd>
          </div>
          <div>
            <dt>Enquêtes en échec</dt>
            <dd [class.bad]="s.investigations.failed > 0">{{ s.investigations.failed }}</dd>
          </div>
          <div>
            <dt>Accord avec les humains</dt>
            <dd>
              @if (s.humanAgreement.reviewed) {
                {{ fmtPercent(s.humanAgreement.agreed / s.humanAgreement.reviewed) }}
                <span class="muted small"
                  >({{ s.humanAgreement.agreed }}/{{ s.humanAgreement.reviewed }})</span
                >
              } @else {
                —
              }
            </dd>
          </div>
        </dl>
      </section>

      <section class="block">
        <span class="label">Verdicts par catégorie</span>
        <ul class="histogram">
          @for (c of histogram(); track c.category) {
            <li [attr.data-category]="c.category">
              <span class="name">{{ c.label }}</span>
              <span class="bar"><span [style.width.%]="c.ratio * 100"></span></span>
              <span class="n">{{ c.count }}</span>
            </li>
          }
        </ul>
      </section>
    } @else {
      <p class="muted">Chargement…</p>
    }
  `,
  styleUrl: './value-panel.css',
})
export class ValuePanel {
  protected readonly store = inject(ControlRoomStore);
  protected readonly fmtDuration = fmtDuration;
  protected readonly fmtNumber = fmtNumber;
  protected readonly fmtPercent = fmtPercent;

  // `/api/stats` ne détaille pas les catégories : calculé à partir de la liste des alertes
  protected readonly histogram = computed(() => {
    const counts = new Map<string, number>();
    for (const alert of this.store.alerts() ?? []) {
      if (alert.category) counts.set(alert.category, (counts.get(alert.category) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return CATEGORIES.filter((c) => c !== 'billing_discrepancy' || counts.has(c)).map(
      (category) => ({
        category,
        label: CATEGORY_LABELS[category],
        count: counts.get(category) ?? 0,
        ratio: (counts.get(category) ?? 0) / max,
      }),
    );
  });
}
