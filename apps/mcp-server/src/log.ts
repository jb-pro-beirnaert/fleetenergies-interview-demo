// Journal JSON sur stderr : stdout est réservé au protocole en mode `--stdio`
export function log(entry: Record<string, unknown>): void {
  console.error(JSON.stringify(entry));
}
