import { Component, computed, input } from '@angular/core';
import type { FuelTransactions } from '@fleet/contracts';
import { fmtDateTime, fmtLiters } from '../../core/format';
import { TOOL_STYLES } from './tool-styles';
import { isRecord } from './tool-window';

const SOURCE_LABELS: Record<string, string> = { fuel_card: 'Carte', invoice: 'Facture' };

@Component({
  selector: 'app-fuel-transactions-view',
  template: `
    @let refuels = list();
    @if (refuels.length === 0) {
      <p class="empty">Aucun plein sur la période</p>
    } @else {
      <table>
        <thead>
          <tr>
            <th>Heure</th>
            <th>Station</th>
            <th class="num">Litres</th>
            <th class="num">Montant</th>
            <th>Source</th>
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
                {{
                  r.totalEur === null
                    ? '—'
                    : r.totalEur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
                }}
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
  protected source(source: string) {
    return SOURCE_LABELS[source] ?? source;
  }
}
