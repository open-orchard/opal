/**
 * Extract the runnable script from an osascript invocation.
 * Handles `... -e '<src>'` and `... -e "<src>"`. If no `-e` wrapper is
 * found, returns the trimmed input (assumed to already be raw script).
 *
 * Limitation: assumes the inner script does not contain an unescaped
 * instance of the same quote character used by `-e`.
 */
export function extractSource(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/-e\s+(['"])([\s\S]*?)\1/);
  if (match) return match[2];
  return trimmed;
}
