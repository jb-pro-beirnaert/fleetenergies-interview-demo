import { Component, computed, input } from '@angular/core';
import type { FuelBalance } from '@fleet/contracts';
import { fmtLiters, fmtNumber } from '../../core/format';
import { t } from '../../core/i18n/i18n';
import { TOOL_STYLES } from './tool-styles';
import { isRecord } from './tool-window';

@Component({
  selector: 'app-fuel-balance-view',
  template: `
    @if (balance(); as b) {
      <div class="figures">
        <div>
          <span class="v">{{ fmtLiters(b.expectedConsumptionL) }}</span>
          <span class="k">{{ t('tools.balance.expected') }}</span>
          <span class="d"
            >{{ fmtNumber(b.distanceKm) }} km ·
            {{ t('tools.balance.idle', { liters: fmtLiters(b.idleConsumptionL) }) }}</span
          >
        </div>
        <div>
          <span class="v">{{ fmtLiters(b.refueledL) }}</span>
          <span class="k">{{ t('tools.balance.refuels') }}</span>
        </div>
        <div>
          <span class="v">{{ fmtLiters(b.observedLevelChangeL) }}</span>
          <span class="k">{{ t('tools.balance.observed') }}</span>
        </div>
        <div class="unexplained" [class.zero]="b.unexplainedLossL < 5">
          <span class="v">{{ fmtLiters(b.unexplainedLossL) }}</span>
          <span class="k">{{ t('tools.balance.unexplained') }}</span>
        </div>
      </div>
    } @else {
      <p class="empty">{{ t('common.unreadable') }}</p>
    }
  `,
  styles: [
    TOOL_STYLES,
    `
      .figures {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }
      .figures > div {
        display: flex;
        flex-direction: column;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--surface-2);
      }
      .v {
        font-size: 22px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .k {
        color: var(--muted);
        font-size: 13px;
      }
      .d {
        color: var(--muted);
        font-size: 13px;
      }
      .unexplained {
        background: color-mix(in srgb, var(--red) 12%, transparent) !important;
        color: var(--red);
      }
      .unexplained .k {
        color: inherit;
      }
      .unexplained.zero {
        background: color-mix(in srgb, var(--green) 12%, transparent) !important;
        color: var(--green);
      }
    `,
  ],
})
export class FuelBalanceView {
  readonly result = input.required<unknown>();
  protected readonly balance = computed(() => {
    const r = this.result();
    return isRecord(r) && typeof r['unexplainedLossL'] === 'number' ? (r as FuelBalance) : null;
  });
  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtNumber = fmtNumber;
  protected readonly t = t;
}
