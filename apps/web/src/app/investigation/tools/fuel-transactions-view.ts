import { Component, computed, input } from '@angular/core';
import type { FuelTransactions } from '@fleet/contracts';
import { fmtDateTime, fmtEuros, fmtLiters } from '../../core/format';
import { type MessageKey, t } from '../../core/i18n/i18n';
import { TOOL_STYLES } from './tool-styles';
import { isRecord } from './tool-window';

const SOURCE_LABELS: Record<string, MessageKey> = {
  fuel_card: 'tools.transactions.source.fuel_card',
  invoice: 'tools.transactions.source.invoice',
};

@Component({
  selector: 'app-fuel-transactions-view',
  template: `
    @let refuels = list();
    @if (refuels.length === 0) {
      <p class="empty">{{ t('tools.transactions.none') }}</p>
    } @else {
      <table>
        <thead>
          <tr>
            <th>{{ t('tools.transactions.time') }}</th>
            <th>{{ t('tools.transactions.station') }}</th>
            <th class="num">{{ t('tools.transactions.liters') }}</th>
            <th class="num">{{ t('tools.transactions.amount') }}</th>
            <th>{{ t('tools.transactions.source') }}</th>
          </tr>
        </thead>
        <tbody>
          @for (r of refuels; track $index) {
            <tr>
              <td>{{ fmtDateTime(r.at) }}</td>
              <td>{{ r.place ?? '—' }}</td>
              <td class="num">
                <strong>{{ fmtLiters(r.liters) }}</strong>
              </td>
              <td class="num">
                {{ fmtEuros(r.totalEur) }}
              </td>
              <td>
                <span class="badge">{{ source(r.source) }}</span>
              </td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: TOOL_STYLES,
})
export class FuelTransactionsView {
  readonly result = input.required<unknown>();
  protected readonly list = computed(() => {
    const r = this.result();
    return isRecord(r) && Array.isArray(r['refuels'])
      ? (r['refuels'] as FuelTransactions['refuels'])
      : [];
  });
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtEuros = fmtEuros;
  protected readonly t = t;
  protected source(source: string) {
    const key = SOURCE_LABELS[source];
    return key ? t(key) : source;
  }
}
