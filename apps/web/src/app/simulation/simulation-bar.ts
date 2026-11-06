import { Component, computed, inject } from '@angular/core';
import type { SimulationCommand } from '@fleet/contracts';
import { fmtNumber } from '../core/format';
import { t } from '../core/i18n/i18n';
import { canRun, neighbourSpeed, simulationLabel } from '../core/simulation';
import { SimulationStore } from '../core/simulation.store';

@Component({
  selector: 'app-simulation-bar',
  template: `
    <strong class="title">{{ t('sim.title') }}</strong>

    <div class="group">
      <button type="button" class="primary" [disabled]="!can('start')" (click)="run('start')">
        {{ t('sim.start') }}
      </button>
      @if (view()?.status === 'paused') {
        <button type="button" [disabled]="!can('resume')" (click)="run('resume')">
          {{ t('sim.resume') }}
        </button>
      } @else {
        <button type="button" [disabled]="!can('pause')" (click)="run('pause')">
          {{ t('sim.pause') }}
        </button>
      }
      <button type="button" [disabled]="!can('stop')" (click)="run('stop')">
        {{ t('sim.stop') }}
      </button>
    </div>

    <div class="group speed" [attr.aria-label]="t('sim.speed')">
      <button
        type="button"
        class="icon"
        [title]="t('sim.slower')"
        [attr.aria-label]="t('sim.slower')"
        [disabled]="!slower()"
        (click)="setSpeed(slower())"
      >
        −
      </button>
      <span class="value" [title]="t('sim.speedTitle')">×{{ view()?.speed ?? '—' }}</span>
      <button
        type="button"
        class="icon"
        [title]="t('sim.faster')"
        [attr.aria-label]="t('sim.faster')"
        [disabled]="!faster()"
        (click)="setSpeed(faster())"
      >
        +
      </button>
    </div>

    <button type="button" class="reset" [disabled]="!can('reset')" (click)="reset()">
      {{ t('sim.reset') }}
    </button>

    <div class="status" [attr.data-status]="statusKey()">
      <span class="label">{{ label() }}</span>
      @if (percent() !== null) {
        <span class="bar" role="progressbar" [attr.aria-valuenow]="percent()" aria-valuemin="0" aria-valuemax="100">
          <span class="fill" [style.width.%]="percent()"></span>
        </span>
      }
      @if (view(); as v) {
        @if (v.status !== 'idle') {
          <span class="alerts">{{ t('sim.alertsCount', { n: fmtNumber(v.alertsCreated) }) }}</span>
        }
      }
      @if (error(); as e) {
        <span class="error" [title]="e">{{ e }}</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 20px;
      height: 48px;
      flex-shrink: 0;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
    }
    .title {
      color: var(--muted);
    }
    .group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    button {
      padding: 5px 12px;
      border-radius: 8px;
      font-weight: 600;
      border: 1px solid var(--border);
      background: var(--surface);
      white-space: nowrap;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .primary {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }
    .icon {
      width: 32px;
      padding: 5px 0;
    }
    .speed .value {
      min-width: 52px;
      text-align: center;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .reset {
      color: var(--red);
    }
    .status {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .label {
      font-weight: 600;
      white-space: nowrap;
    }
    [data-status='running'] .label {
      color: var(--green);
    }
    [data-status='paused'] .label {
      color: var(--orange);
    }
    [data-status='unreachable'] .label {
      color: var(--red);
    }
    .bar {
      width: 140px;
      height: 6px;
      border-radius: 3px;
      background: var(--border);
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      background: var(--accent);
      transition: width 0.4s ease;
    }
    .alerts {
      color: var(--muted);
      white-space: nowrap;
    }
    .error {
      color: var(--red);
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class SimulationBar {
  private readonly store = inject(SimulationStore);
  protected readonly view = this.store.view;
  protected readonly fmtNumber = fmtNumber;
  protected readonly t = t;

  protected readonly slower = computed(() => this.speedStep(-1));
  protected readonly faster = computed(() => this.speedStep(1));

  protected readonly statusKey = computed(() =>
    this.store.reachable() === false ? 'unreachable' : (this.view()?.status ?? 'unknown'),
  );
  protected readonly label = computed(() => {
    if (this.store.reachable() === false) return t('sim.unreachable');
    const view = this.view();
    return view ? simulationLabel(view) : t('sim.connecting');
  });
  protected readonly percent = computed(() => {
    const progress = this.view()?.progress;
    if (!progress || progress.total === 0) return null;
    return Math.round((progress.done / progress.total) * 100);
  });
  protected readonly error = computed(() => {
    const failure = this.store.commandError();
    if (failure) return failure.message ?? t('sim.commandFailed');
    return this.view()?.error ?? null;
  });

  protected can(command: SimulationCommand) {
    return !this.store.busy() && this.store.reachable() !== false && canRun(this.view(), command);
  }

  protected run(command: SimulationCommand) {
    void this.store.run(command);
  }

  protected setSpeed(speed: ReturnType<typeof neighbourSpeed>) {
    if (speed) void this.store.setSpeed(speed);
  }

  protected reset() {
    if (confirm(t('sim.resetConfirm'))) {
      this.run('reset');
    }
  }

  private speedStep(direction: -1 | 1) {
    const view = this.view();
    if (!view || this.store.busy() || this.store.reachable() === false) return null;
    return neighbourSpeed(view.speed, direction);
  }
}
