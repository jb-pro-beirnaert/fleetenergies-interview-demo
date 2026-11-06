import { Component, computed, input } from '@angular/core';
import type { AlertStatus } from '@fleet/contracts';
import { STATUS_LABELS } from './labels';

@Component({
  selector: 'app-status-pill',
  template: `<span class="pill" [attr.data-status]="status()">{{ label() }}</span>`,
  styles: `
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      color: var(--c);
      background: color-mix(in srgb, var(--c) 12%, transparent);
    }
    [data-status='detected'] {
      --c: var(--muted);
    }
    [data-status='investigating'] {
      --c: var(--accent);
    }
    [data-status='closed'] {
      --c: var(--green);
    }
    [data-status='escalated'] {
      --c: var(--orange);
    }
    [data-status='confirmed'] {
      --c: var(--text);
    }
    [data-status='dismissed'] {
      --c: var(--muted);
    }
    [data-status='investigating']::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.25;
        transform: scale(0.7);
      }
    }
  `,
})
export class StatusPill {
  readonly status = input.required<AlertStatus>();
  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
}
