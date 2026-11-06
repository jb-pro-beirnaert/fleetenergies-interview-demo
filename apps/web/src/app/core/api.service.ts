import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AlertDetail,
  AlertList,
  Health,
  Positions,
  ReviewRequest,
  ReviewResult,
  Stats,
  TankCurvePoints,
} from '@fleet/contracts';

export interface TimeWindow {
  from: string;
  to: string;
}

// Routes écran de l'API (`/api/*`, proxifiées par `ng serve` ou nginx)
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  alerts(limit = 200) {
    return this.http.get<AlertList>('/api/alerts', { params: { limit } });
  }

  alert(id: string) {
    return this.http.get<AlertDetail>(`/api/alerts/${id}`);
  }

  review(id: string, request: ReviewRequest) {
    return this.http.post<ReviewResult>(`/api/alerts/${id}/review`, request);
  }

  tankCurve(truckId: string, window: TimeWindow) {
    return this.http.get<TankCurvePoints>(`/api/trucks/${truckId}/tank-curve`, {
      params: { ...window },
    });
  }

  positions(truckId: string, window: TimeWindow) {
    return this.http.get<Positions>(`/api/trucks/${truckId}/positions`, {
      params: { ...window },
    });
  }

  stats() {
    return this.http.get<Stats>('/api/stats');
  }

  health() {
    return this.http.get<Health>('/api/health');
  }
}
