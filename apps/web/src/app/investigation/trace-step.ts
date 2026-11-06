import { Component, computed, input, signal } from '@angular/core';
import type { AlertDetail } from '@fleet/contracts';
import { fmtDateTime } from '../core/format';
import { toolPhrase } from '../core/labels';
import type { TraceItem } from '../core/trace';
import { ActivityView } from './tools/activity-view';
import { DriverMessagesView } from './tools/driver-messages-view';
import { FuelBalanceView } from './tools/fuel-balance-view';
import { FuelTransactionsView } from './tools/fuel-transactions-view';
import { SimilarEventsView } from './tools/similar-events-view';
import { TankCurveView } from './tools/tank-curve-view';
import { TruckProfileView } from './tools/truck-profile-view';

const isIso = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));

@Component({
  selector: 'app-trace-step',
  imports: [
    TruckProfileView,
    TankCurveView,
    ActivityView,
    FuelTransactionsView,
    DriverMessagesView,
    FuelBalanceView,
    SimilarEventsView,
  ],
  template: `
    @switch (item().kind) {
      @case ('tool') {
        @if (tool(); as tool) {
          <div class="step tool" [id]="anchor()">
            <div class="line">
              <span class="ref">{{ tool.ref ?? '—' }}</span>
              <span class="phrase">{{ phrase() }}</span>
              @if (period(); as p) {
                <span class="period">{{ p }}</span>
              }
              <span class="duration">
                @if (tool.result === undefined) {
                  <span class="dots">…</span>
                } @else if (tool.durationMs !== null) {
                  {{ tool.durationMs }} ms
                }
              </span>
            </div>
            @if (tool.result; as result) {
              @if (result.ok) {
                <div class="render">
                  @switch (tool.toolName) {
                    @case ('get_truck_profile') {
                      <app-truck-profile-view [result]="result.value" />
                    }
                    @case ('get_tank_curve') {
                      @defer {
                        <app-tank-curve-view
                          [result]="result.value"
                          [alert]="alert()"
                          [args]="tool.args"
                        />
                      } @placeholder (minimum 0ms) {
                        <div class="lazy">Chargement du graphique…</div>
                      }
                    }
                    @case ('get_vehicle_activity') {
                      @defer {
                        <app-activity-view
                          [result]="result.value"
                          [alert]="alert()"
                          [args]="tool.args"
                        />
                      } @placeholder (minimum 0ms) {
                        <div class="lazy">Chargement de la carte…</div>
                      }
                    }
                    @case ('find_fuel_transactions') {
                      <app-fuel-transactions-view [result]="result.value" />
                    }
                    @case ('read_driver_messages') {
                      <app-driver-messages-view [result]="result.value" />
                    }
                    @case ('compute_fuel_balance') {
                      <app-fuel-balance-view [result]="result.value" />
                    }
                    @case ('find_similar_events') {
                      <app-similar-events-view [result]="result.value" />
                    }
                    @default {
                      <pre>{{ json(result.value) }}</pre>
                    }
                  }
                </div>
              } @else {
                <div class="tool-error">L’outil a renvoyé une erreur : {{ result.error }}</div>
              }
            }
          </div>
        }
      }
      @case ('reasoning') {
        @if (reasoning(); as r) {
          <div class="step reasoning">
            <button
              type="button"
              class="toggle"
              (click)="open.set(!open())"
              [attr.aria-expanded]="open()"
            >
              {{ open() ? '▾' : '▸' }} Réflexion du modèle
            </button>
            @if (open()) {
              <p>{{ r.text }}</p>
            }
          </div>
        }
      }
      @case ('retry') {
        <div class="step retry">↻ Relance : {{ message() }}</div>
      }
      @case ('error') {
        <div class="step error">✕ Erreur : {{ message() }}</div>
      }
      @case ('verdict') {
        <div class="step verdict-line">✓ Verdict soumis</div>
      }
    }
  `,
  styleUrl: './trace-step.css',
})
export class TraceStep {
  readonly item = input.required<TraceItem>();
  readonly alert = input.required<AlertDetail>();
  readonly anchor = input<string | null>(null);

  protected readonly open = signal(false);

  protected readonly tool = computed(() => {
    const item = this.item();
    return item.kind === 'tool' ? item : null;
  });
  protected readonly reasoning = computed(() => {
    const item = this.item();
    return item.kind === 'reasoning' ? item : null;
  });
  protected readonly message = computed(() => {
    const item = this.item();
    return item.kind === 'retry' || item.kind === 'error' ? item.message : '';
  });
  protected readonly phrase = computed(() => toolPhrase(this.tool()?.toolName ?? null));

  protected readonly period = computed(() => {
    const args = this.tool()?.args;
    if (!args) return null;
    if (isIso(args['from']) && isIso(args['to'])) {
      return `${fmtDateTime(args['from'])} → ${fmtDateTime(args['to'])}`;
    }
    if (typeof args['lookbackDays'] === 'number') return `${args['lookbackDays']} derniers jours`;
    return null;
  });

  protected json(value: unknown) {
    return JSON.stringify(value, null, 2);
  }
}
