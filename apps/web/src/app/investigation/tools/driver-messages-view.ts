import { Component, computed, input } from '@angular/core';
import type { DriverMessages } from '@fleet/contracts';
import { fmtDateTime } from '../../core/format';
import { TOOL_STYLES } from './tool-styles';
import { isRecord } from './tool-window';

// Découpe le texte pour rendre visibles les passages masqués par le module `pii`
const MASK = /(\[[^\]]*masqué\])/g;

@Component({
  selector: 'app-driver-messages-view',
  template: `
    @let messages = list();
    @if (messages.length === 0) {
      <p class="empty">Aucun message sur la période</p>
    } @else {
      <div class="bubbles">
        @for (m of messages; track $index) {
          <div class="bubble">
            <div class="meta">
              <strong>{{ m.driver }}</strong> · {{ fmtDateTime(m.sentAt) }}
            </div>
            <p>
              @for (part of split(m.body); track $index) {
                @if (part.masked) {
                  <span class="masked" title="Masqué avant transmission à l’agent">{{
                    part.text
                  }}</span>
                } @else {
                  {{ part.text }}
                }
              }
            </p>
          </div>
        }
      </div>
    }
  `,
  styles: [
    TOOL_STYLES,
    `
      .bubbles {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .bubble {
        max-width: 85%;
        padding: 8px 12px;
        border-radius: 4px 14px 14px 14px;
        background: var(--surface-2);
      }
      .meta {
        font-size: 13px;
        color: var(--muted);
      }
      .meta strong {
        font-family: var(--mono);
        color: var(--accent);
      }
      p {
        margin: 4px 0 0;
      }
      .masked {
        font-family: var(--mono);
        font-size: 13px;
        padding: 0 4px;
        border-radius: 4px;
        background: var(--text);
        color: var(--surface);
      }
    `,
  ],
})
export class DriverMessagesView {
  readonly result = input.required<unknown>();
  protected readonly list = computed(() => {
    const r = this.result();
    return isRecord(r) && Array.isArray(r['messages'])
      ? (r['messages'] as DriverMessages['messages'])
      : [];
  });
  protected readonly fmtDateTime = fmtDateTime;

  protected split(body: string) {
    return body
      .split(MASK)
      .filter((text) => text !== '')
      .map((text) => ({ text, masked: /^\[[^\]]*masqué\]$/.test(text) }));
  }
}
