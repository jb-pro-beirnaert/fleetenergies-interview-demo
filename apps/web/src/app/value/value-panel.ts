import { Component, computed, inject } from '@angular/core';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtDuration, fmtNumber, fmtPercent } from '../core/format';
import { t } from '../core/i18n/i18n';
import { CATEGORIES, categoryLabel } from '../core/labels';

@Component({
  selector: 'app-value-panel',
  template: `
    <h2>{{ t('value.title') }}</h2>
    @if (store.stats(); as s) {
      <section class="block without">
        <span class="label">{{ t('value.without') }}</span>
        <span class="hero">{{ s.ruleOnly.toReviewManually }}</span>
        <span>{{ t('value.manual') }}</span>
      </section>

      <section class="block with">
        <span class="label">{{ t('value.with') }}</span>
        <div class="grid">
          <div class="green">
            <span class="hero">{{ s.withAgents.autoClosed }}</span>
            <span>{{ t('value.autoClosed') }}</span>
          </div>
          <div class="orange">
            <span class="hero">{{ s.withAgents.escalated }}</span>
            <span>{{ t('value.escalated') }}</span>
          </div>
        </div>
        <span class="muted">{{ t('value.pending', { n: s.withAgents.pending }) }}</span>
      </section>

      <section class="block">
        <dl>
          <div>
            <dt>{{ t('value.avgDuration') }}</dt>
            <dd>{{ fmtDuration(s.investigations.avgDurationSeconds) }}</dd>
          </div>
          <div>
            <dt>{{ t('value.avgToolCalls') }}</dt>
            <dd>{{ fmtNumber(s.investigations.avgToolCalls, true) }}</dd>
          </div>
          <div>
            <dt>{{ t('value.failed') }}</dt>
            <dd [class.bad]="s.investigations.failed > 0">{{ s.investigations.failed }}</dd>
          </div>
          <div>
            <dt>{{ t('value.agreement') }}</dt>
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
        <span class="label">{{ t('value.byCategory') }}</span>
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
      <p class="muted">{{ t('common.loading') }}</p>
    }
  `,
  styleUrl: './value-panel.css',
})
export class ValuePanel {
  protected readonly store = inject(ControlRoomStore);
  protected readonly fmtDuration = fmtDuration;
  protected readonly fmtNumber = fmtNumber;
  protected readonly fmtPercent = fmtPercent;
  protected readonly t = t;

  // `/api/stats` does not break down categories: computed from the alert list
  protected readonly histogram = computed(() => {
    const counts = new Map<string, number>();
    for (const alert of this.store.alerts() ?? []) {
      if (alert.category) counts.set(alert.category, (counts.get(alert.category) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return CATEGORIES.filter((c) => c !== 'billing_discrepancy' || counts.has(c)).map(
      (category) => ({
        category,
        label: categoryLabel(category),
        count: counts.get(category) ?? 0,
        ratio: (counts.get(category) ?? 0) / max,
      }),
    );
  });
}
