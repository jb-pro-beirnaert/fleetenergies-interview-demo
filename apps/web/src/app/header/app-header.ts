import { Component, computed, inject } from '@angular/core';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtDateTime } from '../core/format';
import { LANGS, currentLang, setLang, t } from '../core/i18n/i18n';

@Component({
  selector: 'app-header',
  template: `
    <div class="brand">
      <span class="logo" aria-hidden="true">⛽</span>
      <strong>Fleet Copilot</strong>
      <span class="sep">·</span>
      <span>{{ t('header.subtitle') }}</span>
    </div>

    <nav class="tabs" [attr.aria-label]="t('header.sections')">
      <a class="tab active" aria-current="page">{{ t('header.tab.alerts') }}</a>
      <span class="tab disabled" [title]="t('header.tab.invoicesSoon')">{{
        t('header.tab.invoices')
      }}</span>
    </nav>

    <div class="meta">
      <span class="clock" [title]="t('header.clock.title')">
        {{ t('header.clock.label') }} <strong>{{ simulatedNow() }}</strong>
      </span>
      <span class="model" [title]="t('header.model.title')">{{ model() }}</span>
      <div class="lang" role="group" [attr.aria-label]="t('lang.label')">
        @for (l of langs; track l) {
          <button
            type="button"
            [class.active]="lang() === l"
            [attr.aria-pressed]="lang() === l"
            (click)="setLang(l)"
          >
            {{ l.toUpperCase() }}
          </button>
        }
      </div>
      <span
        class="health"
        [class.ok]="store.healthy() === true"
        [class.ko]="store.healthy() === false"
        [title]="healthLabel()"
        [attr.aria-label]="healthLabel()"
      ></span>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 0 20px;
      height: 56px;
      flex-shrink: 0;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 17px;
    }
    .logo {
      font-size: 20px;
    }
    .sep {
      color: var(--muted);
    }
    .tabs {
      display: flex;
      gap: 4px;
      height: 100%;
    }
    .tab {
      display: flex;
      align-items: center;
      padding: 0 14px;
      font-weight: 600;
      color: var(--muted);
      border-bottom: 3px solid transparent;
    }
    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    .tab.disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .meta {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 18px;
      color: var(--muted);
    }
    .clock strong {
      color: var(--text);
      font-size: 18px;
      font-variant-numeric: tabular-nums;
      margin-left: 6px;
    }
    .model {
      font-family: var(--mono);
      font-size: 13px;
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--surface-2);
    }
    .lang {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .lang button {
      padding: 3px 8px;
      border: 0;
      background: var(--surface);
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    .lang button.active {
      background: var(--accent);
      color: white;
    }
    .health {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--muted);
    }
    .health.ok {
      background: var(--green);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 25%, transparent);
    }
    .health.ko {
      background: var(--red);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 25%, transparent);
    }
  `,
})
export class AppHeader {
  protected readonly store = inject(ControlRoomStore);
  protected readonly t = t;
  protected readonly langs = LANGS;
  protected readonly lang = currentLang;
  protected readonly setLang = setLang;

  protected readonly simulatedNow = computed(() => {
    const at = this.store.stats()?.simulatedNow;
    return at ? fmtDateTime(at) : '—';
  });
  protected readonly model = computed(() => this.store.stats()?.model ?? t('header.model.none'));
  protected readonly healthLabel = computed(() => {
    switch (this.store.healthy()) {
      case true:
        return t('header.health.ok');
      case false:
        return t('header.health.ko');
      default:
        return t('header.health.connecting');
    }
  });
}
