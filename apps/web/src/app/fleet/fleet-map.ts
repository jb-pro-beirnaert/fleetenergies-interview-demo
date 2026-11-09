import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { FleetTruck } from '@fleet/contracts';
import * as L from 'leaflet';
import { fmtDateTime, fmtLiters } from '../core/format';
import { currentLang } from '../core/i18n/i18n';
import { STATE_COLORS, stateLabel } from './fleet-state';

/** Latest position of every truck (colour = state), route over the window; the selected one stands out */
@Component({
  selector: 'app-fleet-map',
  template: `<div class="map" #map></div>`,
  styles: `
    .map {
      height: 320px;
      border-radius: 10px;
      border: 1px solid var(--border);
      z-index: 0;
    }
    :host ::ng-deep .plate-label {
      padding: 0 4px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 4px;
      box-shadow: none;
    }
  `,
})
export class FleetMap {
  readonly trucks = input.required<FleetTruck[]>();
  readonly selectedId = input<string | null>(null);
  readonly select = output<string>();

  private readonly mapElement = viewChild.required<ElementRef<HTMLElement>>('map');
  private map: L.Map | null = null;
  private routes: L.LayerGroup | null = null;
  private markers: L.LayerGroup | null = null;
  private fitted = false;
  private followed: string | null = null;

  constructor() {
    effect(() => {
      const trucks = this.trucks();
      const selected = this.selectedId();
      currentLang(); // tooltips follow the language
      this.draw(trucks, selected);
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private draw(trucks: FleetTruck[], selectedId: string | null) {
    if (!this.map) {
      this.map = L.map(this.mapElement().nativeElement);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap',
      }).addTo(this.map);
      this.routes = L.layerGroup().addTo(this.map);
      this.markers = L.layerGroup().addTo(this.map);
      this.map.setView([43.9, 5.0], 8); // Provence, until the first positions
    }
    this.routes!.clearLayers();
    this.markers!.clearLayers();

    for (const truck of trucks) {
      const selected = truck.id === selectedId;
      const route = truck.readings.map((r) => L.latLng(r.lat, r.lon));
      if (route.length > 1) {
        L.polyline(route, {
          color: selected ? '#2563eb' : '#64748b',
          weight: selected ? 4 : 2,
          opacity: selected ? 0.85 : selectedId ? 0.15 : 0.3,
        }).addTo(this.routes!);
      }
      const last = truck.last;
      if (!last) continue;
      L.circleMarker([last.lat, last.lon], {
        radius: selected ? 10 : 7,
        color: selected ? '#0f172a' : '#fff',
        weight: 2,
        fillColor: STATE_COLORS[truck.state],
        fillOpacity: 1,
      })
        .bindTooltip(truck.plate, {
          permanent: true,
          direction: 'top',
          offset: [0, -8],
          className: 'plate-label',
        })
        .bindPopup(
          `<strong>${truck.plate}</strong> · ${stateLabel(truck.state)}<br>` +
            `${Math.round(last.speedKmh)} km/h · ${fmtLiters(last.levelL)}<br>` +
            `<span style="color:#64748b">${fmtDateTime(last.at)}</span>`,
        )
        .on('click', () => this.select.emit(truck.id))
        .addTo(this.markers!);
    }

    const positions = trucks.flatMap((t) => (t.last ? [L.latLng(t.last.lat, t.last.lon)] : []));
    if (!this.fitted && positions.length) {
      this.map.invalidateSize(); // the container may have been sized after the map was created
      this.map.fitBounds(L.latLngBounds(positions), { padding: [30, 30], maxZoom: 11 });
      this.fitted = true;
    }
    // Newly selected truck: centre on it once, then let the user pan freely
    const selected = trucks.find((t) => t.id === selectedId);
    if (selectedId !== this.followed) {
      this.followed = selectedId;
      if (selected?.last) this.map.panTo([selected.last.lat, selected.last.lon]);
    }
  }
}
