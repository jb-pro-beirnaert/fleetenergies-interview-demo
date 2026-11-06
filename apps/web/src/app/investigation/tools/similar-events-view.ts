import { Component, computed, input } from '@angular/core';
import type { SimilarEvents } from '@fleet/contracts';
import { fmtDateTime, fmtLiters } from '../../core/format';
import { t } from '../../core/i18n/i18n';
import { categoryLabel, placeTypeLabel } from '../../core/labels';
import { TOOL_STYLES } from './tool-styles';
import { isRecord } from './tool-window';

@Component({
  selector: 'app-similar-events-view',
  template: `
    @let events = list();
    @if (events.length === 0) {
      <p class="empty">{{ t('tools.similar.none') }}</p>
    } @else {
      <ol class="timeline">
        @for (e of events; track $index) {
          <li [attr.data-category]="e.verdictCategory">
            <span class="dot"></span>
            <span class="when">{{ fmtDateTime(e.at) }}</span>
            <strong>{{ fmtLiters(e.dropL) }}</strong>
            <span class="muted">
              {{ e.placeType ? placeTypeLabel(e.placeType) : t('tools.similar.unknownPlace')
              }}{{ e.ignitionOff ? ' · ' + t('common.engineOff') : '' }}
            </span>
            <span class="verdict">{{
              e.verdictCategory ? categoryLabel(e.verdictCategory) : t('tools.similar.noVerdict')
            }}</span>
          </li>
        }
      </ol>
    }
  `,
  styles: [
    TOOL_STYLES,
    `
      .timeline {
        list-style: none;
        margin: 0;
        padding: 0 0 0 6px;
        border-left: 2px solid var(--border);
      }
      li {
        --c: var(--muted);
        position: relative;
        display: flex;
        gap: 10px;
        align-items: baseline;
        padding: 4px 0 4px 14px;
        font-variant-numeric: tabular-nums;
      }
      li[data-category='theft_suspected'] {
        --c: var(--red);
      }
      li[data-category='sensor_fault'],
      li[data-category='equipment_transfer'],
      li[data-category='legitimate_operation'] {
        --c: var(--green);
      }
      li[data-category='inconclusive'],
      li[data-category='billing_discrepancy'] {
        --c: var(--orange);
      }
      .dot {
        position: absolute;
        left: -7px;
        top: 10px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--c);
      }
      .when {
        min-width: 100px;
      }
      .verdict {
        margin-left: auto;
        font-weight: 600;
        color: var(--c);
      }
    `,
  ],
})
export class SimilarEventsView {
  readonly result = input.required<unknown>();
  protected readonly list = computed(() => {
    const r = this.result();
    return isRecord(r) && Array.isArray(r['events'])
      ? (r['events'] as SimilarEvents['events'])
      : [];
  });
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly fmtLiters = fmtLiters;
  protected readonly t = t;
  protected readonly categoryLabel = categoryLabel;
  protected readonly placeTypeLabel = placeTypeLabel;
}
