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
 * Appelle `request` toutes les `intervalMs` (immédiatement au départ), suspendu quand
 * l'onglet est masqué et relancé dès qu'il redevient visible. Une erreur ne coupe pas le
 * polling : elle est émise comme `{ ok: false }`.
 * À appeler dans un contexte d'injection.
 */
export function poll<T>(
  request: () => Observable<T>,
  intervalMs = POLL_INTERVAL_MS,
): Observable<PollResult<T>> {
  const document = inject(DOCUMENT);
  return fromEvent(document, 'visibilitychange').pipe(
    map(() => document.visibilityState === 'visible'),
    startWith(document.visibilityState === 'visible'),
    distinctUntilChanged(),
    switchMap((visible) => (visible ? timer(0, intervalMs) : EMPTY)),
    // exhaustMap : une requête lente n'est pas doublée par le tick suivant
    exhaustMap(() =>
      request().pipe(
        map((value): PollResult<T> => ({ ok: true, value })),
        catchError((error: unknown) => of<PollResult<T>>({ ok: false, error })),
      ),
    ),
  );
}
