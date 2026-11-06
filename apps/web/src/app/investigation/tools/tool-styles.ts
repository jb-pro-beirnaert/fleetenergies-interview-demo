// Styles shared by the tool renderings
export const TOOL_STYLES = `
  :host { display: block; }
  .empty { color: var(--muted); font-style: italic; margin: 0; }
  .muted { color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: 13px; padding: 4px 8px; }
  td { padding: 5px 8px; border-top: 1px solid var(--border); }
  td.num, th.num { text-align: right; }
  .badge {
    display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 13px; font-weight: 600;
    background: var(--surface-2); color: var(--text);
  }
`;
