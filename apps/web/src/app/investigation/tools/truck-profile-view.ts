import { Component, computed, input } from '@angular/core';
import type { TruckProfile } from '@fleet/contracts';
import { fmtLiters, fmtNumber } from '../../core/format';
import { TOOL_STYLES } from './tool-styles';
import { isRecord } from './tool-window';

@Component({
  selector: 'app-truck-profile-view',
  template: `
    @if (profile(); as p) {
      <div class="id-card">
        <div class="main">
          <span class="plate">{{ p.plate }}</span>
          <span>{{ p.make }} {{ p.model }} · {{ p.energy }}</span>
        </div>
        <dl>
          <div>
            <dt>Réservoir</dt>
            <dd>{{ fmtLiters(p.tankCapacityL) }}</dd>
          </div>
          <div>
            <dt>Conso. habituelle</dt>
            <dd>{{ fmtNumber(p.baselineLPer100km, true) }} L/100 km</dd>
          </div>
          <div>
            <dt>Ralenti</dt>
            <dd>{{ fmtNumber(p.idleLPerHour, true) }} L/h</dd>
          </div>
          <div>
            <dt>Dépôt</dt>
            <dd>{{ p.homeDepot }}</dd>
          </div>
        </dl>
        <div class="badges">
          @if (p.hasReefer) {
            <span class="badge reefer">❄ Groupe frigo</span>
          }
          @if (p.sensorNotes) {
            <span class="badge notes">⚠ Notes sonde</span>
          }
        </div>
        @if (p.sensorNotes) {
          <p class="notes-text">{{ p.sensorNotes }}</p>
        }
      </div>
    } @else {
      <p class="empty">Résultat illisible</p>
    }
  `,
  styles: [
    TOOL_STYLES,
    `
      .id-card {
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 14px;
        background: var(--surface-2);
      }
      .main {
        display: flex;
        gap: 12px;
        align-items: baseline;
      }
      .plate {
        font-family: var(--mono);
        font-weight: 700;
        font-size: 16px;
      }
      dl {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin: 10px 0 0;
      }
      dt {
        color: var(--muted);
        font-size: 13px;
      }
      dd {
        margin: 0;
        font-weight: 600;
      }
      .badges {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      .badges:empty {
        display: none;
      }
      .reefer {
        background: color-mix(in srgb, var(--accent) 14%, transparent);
        color: var(--accent);
      }
      .notes {
        background: color-mix(in srgb, var(--orange) 14%, transparent);
        color: var(--orange);
      }
      .notes-text {
        margin: 6px 0 0;
        font-style: italic;
      }
    `,
  ],
})
export class TruckProfileView {
  readonly result = input.required<unknown>();
  protected readonly profile = computed(() => {
    const r = this.result();
    return isRecord(r) && typeof r['plate'] === 'string' ? (r as TruckProfile) : null;
  });
  protected readonly fmtLiters = fmtLiters;
  protected readonly fmtNumber = fmtNumber;
}
