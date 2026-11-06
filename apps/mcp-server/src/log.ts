// JSON log on stderr: stdout is reserved for the protocol in `--stdio` mode
export function log(entry: Record<string, unknown>): void {
  console.error(JSON.stringify(entry));
}
