import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AlertListItem } from '@fleet/contracts';
import { ControlRoomStore } from './control-room.store';

const item = (id: string, status: AlertListItem['status']): AlertListItem => ({
  id,
  type: 'fuel_drop',
  status,
  decision: null,
  plate: 'AB-123-CD',
  carrier: 'Transports Test',
  detectedAt: '2026-10-14T02:00:00Z',
  windowStart: '2026-10-14T01:00:00Z',
  windowEnd: '2026-10-14T01:30:00Z',
  dropL: 80,
  category: null,
  confidence: null,
  toolCallsCount: null,
});

describe('ControlRoomStore — sélection', () => {
  let store: ControlRoomStore;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(ControlRoomStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.useRealTimers());

  // premier tick du polling (timer(0)), puis réponse de l'API
  const answerAlerts = (alerts: AlertListItem[]) => {
    vi.advanceTimersByTime(0);
    const requests = http.match((r) => r.url === '/api/alerts');
    expect(requests.length).toBeGreaterThan(0);
    requests.forEach((r) => r.flush(alerts));
  };

  it('sélectionne automatiquement la dernière alerte en enquête', () => {
    answerAlerts([item('a', 'closed'), item('b', 'investigating'), item('c', 'investigating')]);
    expect(store.selectedId()).toBe('b');
  });

  it('se rabat sur la plus récente quand aucune enquête ne tourne', () => {
    answerAlerts([item('a', 'escalated'), item('b', 'closed')]);
    expect(store.selectedId()).toBe('a');
  });

  it('respecte un choix explicite de l’utilisateur', () => {
    answerAlerts([item('a', 'investigating'), item('b', 'closed')]);
    store.select('b');
    expect(store.selectedId()).toBe('b');
  });

  it('filtre les alertes à traiter et les classées', () => {
    answerAlerts([
      item('a', 'escalated'),
      item('b', 'closed'),
      item('c', 'dismissed'),
      item('d', 'detected'),
    ]);
    store.feedFilter.set('todo');
    expect(store.filteredAlerts().map((a) => a.id)).toEqual(['a']);
    store.feedFilter.set('closed');
    expect(store.filteredAlerts().map((a) => a.id)).toEqual(['b', 'c']);
  });
});
