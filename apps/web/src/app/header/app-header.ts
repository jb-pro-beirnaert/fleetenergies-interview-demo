import { Component, computed, inject } from '@angular/core';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtDateTime } from '../core/format';

@Component({
  selector: 'app-header',
  template: `
    <div class="brand">
      <span class="logo" aria-hidden="true">⛽</span>
      <strong>Fleet Copilot</strong>
      <span class="sep">·</span>
      <span>Salle de contrôle</span>
    </div>

    <nav class="tabs" aria-label="Sections">
      <a class="tab active" aria-current="page">Alertes</a>
      <span class="tab disabled" title="Disponible en V2">Factures</span>
    </nav>

    <div class="meta">
      <span class="clock" title="Dernier relevé reçu de la journée de démo">
        Heure simulée <strong>{{ simulatedNow() }}</strong>
      </span>
      <span class="model" title="Modèle utilisé par les agents">{{ model() }}</span>
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

  protected readonly simulatedNow = computed(() => {
    const at = this.store.stats()?.simulatedNow;
    return at ? fmtDateTime(at) : '—';
  });
  protected readonly model = computed(() => this.store.stats()?.model ?? 'modèle —');
  protected readonly healthLabel = computed(() => {
    switch (this.store.healthy()) {
      case true:
        return 'API disponible';
      case false:
        return 'API injoignable';
      default:
        return 'Connexion à l’API…';
    }
  });
}
