# Web — control room

Angular 22 (standalone components, signals). See `specs/07-web.md`.

```bash
npm start -w apps/web     # ng serve on http://localhost:4200 (proxies /api and /simulation)
npm test -w apps/web      # Vitest
npm run build -w apps/web
```

## Languages

The UI is available in English (default) and French, switchable from the header (`EN` / `FR`);
the choice is remembered in `localStorage` (`fleet.lang`).

- Dictionaries: `src/app/core/i18n/en.ts` (reference, defines the keys) and `fr.ts` (same keys, enforced by its type).
- `t(key, params?)` (`src/app/core/i18n/i18n.ts`) reads the current language from a global signal: templates call it directly and re-render on a switch.
- Dates and numbers (`src/app/core/format.ts`) follow the language too (`en-GB` / `fr-FR`); times are always shown in Paris time.
- Content produced by the API, the simulator or the agents (verdict summaries, driver messages…) is shown as received.
