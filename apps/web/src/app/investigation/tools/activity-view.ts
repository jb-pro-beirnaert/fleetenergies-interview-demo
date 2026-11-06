import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { AlertDetail, Positions, VehicleActivity } from '@fleet/contracts';
import * as L from 'leaflet';
import { ApiService } from '../../core/api.service';
import { fmtDateTime, fmtMinutes, fmtNumber, fmtTime } from '../../core/format';
import { currentLang, t } from '../../core/i18n/i18n';
import { PLACE_TYPE_COLORS, placeTypeLabel } from '../../core/labels';
import { TOOL_STYLES } from './tool-styles';
import { isRecord, toolWindow } from './tool-window';

type Stop = VehicleActivity['stops'][number];

@Component({
  selector: 'app-activity-view',
  template: `
    <div class="layout">
      <div class="map" #map></div>
      <div class="side">
        @if (activity(); as a) {
          <p class="totals">
            <strong>{{ fmtNumber(a.distanceKm) }} km</strong> ·
            {{ t('tools.activity.moving', { duration: fmtMinutes(a.movingMinutes) }) }}
          </p>
          @if (a.stops.length === 0) {
            <p class="empty">{{ t('tools.activity.noStops') }}</p>
          } @else {
            <ol class="stops">
              @for (s of a.stops; track $index) {
                <li>
                  <span class="dot" [style.background]="color(s)"></span>
                  <div>
                    <div>
                      <strong>{{ s.place?.name ?? t('common.unlistedPlace') }}</strong>
                      <span class="muted">
                        · {{ placeTypeLabel(s.place?.type ?? 'other') }}</span
                      >
                    </div>
                    <div class="muted">
                      {{ fmtDateTime(s.from) }}–{{ fmtTime(s.to) }} ·
                      {{ fmtMinutes(s.durationMin) }}
                      @if (s.ignitionOff) {
                        · <span class="off">{{ t('common.engineOff') }}</span>
                      }
                    </div>
                  </div>
                </li>
              }
            </ol>
          }
        } @else {
          <p class="empty">{{ t('common.unreadable') }}</p>
        }
      </div>
    </div>
  `,
  styles: [
    TOOL_STYLES,
    `
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
        gap: 12px;
      }
      .map {
        height: 240px;
        border-radius: 10px;
        border: 1px solid var(--border);
        z-index: 0;
      }
      .side {
        max-height: 240px;
        overflow-y: auto;
      }
      .totals {
        margin: 0 0 6px;
      }
      .stops {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .stops li {
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }
      .dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex-shrink: 0;
        margin-top: 4px;
      }
      .off {
        color: var(--orange);
        font-weight: 600;
      }
    `,
  ],
})
export class ActivityView {
  private readonly api = inject(ApiService);

  readonly result = input.required<unknown>();
  readonly alert = input.required<AlertDetail>();
  readonly args = input.required<Record<string, unknown>>();

  private readonly mapElement = viewChild.required<ElementRef<HTMLElement>>('map');
  private readonly window = toolWindow(this.alert, this.args);

  protected readonly positions = rxResource({
    params: () => this.window(),
    stream: ({ params }) => this.api.positions(params.truckId, params),
  });

  protected readonly activity = computed(() => {
    const r = this.result();
    return isRecord(r) && Array.isArray(r['stops']) ? (r as VehicleActivity) : null;
  });

  protected readonly t = t;
  protected readonly placeTypeLabel = placeTypeLabel;
  protected readonly fmtDateTime = fmtDateTime;
  protected readonly fmtTime = fmtTime;
  protected readonly fmtMinutes = fmtMinutes;
  protected readonly fmtNumber = fmtNumber;

  private map: L.Map | null = null;
  private layers: L.LayerGroup | null = null;

  constructor() {
    effect(() => {
      const positions = this.positions.hasValue() ? this.positions.value() : [];
      currentLang(); // redraw the tooltips when the language changes
      this.draw(positions, this.activity()?.stops ?? []);
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  protected color(stop: Stop) {
    return PLACE_TYPE_COLORS[stop.place?.type ?? 'other'];
  }

  private draw(positions: Positions, stops: Stop[]) {
    if (!this.map) {
      this.map = L.map(this.mapElement().nativeElement, {
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap',
      }).addTo(this.map);
      this.layers = L.layerGroup().addTo(this.map);
      this.map.setView([46.6, 2.4], 5);
    }
    const layers = this.layers!;
    layers.clearLayers();

    const route = positions.map((p) => L.latLng(p.lat, p.lon));
    if (route.length > 1) {
      L.polyline(route, { color: '#2563eb', weight: 3, opacity: 0.7 }).addTo(layers);
    }
    for (const stop of stops) {
      L.circleMarker([stop.lat, stop.lon], {
        radius: stop.ignitionOff ? 9 : 7,
        color: '#fff',
        weight: 2,
        fillColor: this.color(stop),
        fillOpacity: 1,
      })
        .bindTooltip(
          `${stop.place?.name ?? t('common.unlistedPlace')} · ${fmtTime(stop.from)}–${fmtTime(stop.to)}${stop.ignitionOff ? ` · ${t('common.engineOff')}` : ''}`,
        )
        .addTo(layers);
    }

    const bounds = L.latLngBounds([...route, ...stops.map((s) => L.latLng(s.lat, s.lon))]);
    if (bounds.isValid()) this.map.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
  }
}
