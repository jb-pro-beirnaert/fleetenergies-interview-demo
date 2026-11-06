import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';
import {
  EMPTY,
  Observable,
  catchError,
  distinctUntilChanged,
  exhaustMap,
  fromEvent,
  map,
  of,
  startWith,
  switchMap,
  timer,
} from 'rxjs';

export const POLL_INTERVAL_MS = 2_000;

export type PollResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Calls `request` every `intervalMs` (immediately at first), suspended while the tab is
 * hidden and restarted as soon as it is visible again. An error does not stop the
 * polling: it is emitted as `{ ok: false }`.
 * Must be called in an injection context, unless `document` is passed explicitly (e.g. when
 * the poll is created later, inside an RxJS operator).
 */
export function poll<T>(
  request: () => Observable<T>,
  intervalMs = POLL_INTERVAL_MS,
  document: Document = inject(DOCUMENT),
): Observable<PollResult<T>> {
  return fromEvent(document, 'visibilitychange').pipe(
    map(() => document.visibilityState === 'visible'),
    startWith(document.visibilityState === 'visible'),
    distinctUntilChanged(),
    switchMap((visible) => (visible ? timer(0, intervalMs) : EMPTY)),
    // exhaustMap: a slow request is not doubled by the next tick
    exhaustMap(() =>
      request().pipe(
        map((value): PollResult<T> => ({ ok: true, value })),
        catchError((error: unknown) => of<PollResult<T>>({ ok: false, error })),
      ),
    ),
  );
}
