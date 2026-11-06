// One JSON line per event
export function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
}
