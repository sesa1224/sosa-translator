import { execFile } from 'node:child_process';

/** How long `claude auth status` may take before the answer counts as unknown. */
export const AUTH_TIMEOUT_MS = 5000;

/**
 * Whether the CLI is logged in, from the JSON `claude auth status` prints ({ "loggedIn": true, ... }).
 * null when it could not be run, did not answer in time, or printed something else.
 */
export function claudeLoggedIn(cmd: { command: string; prefixArgs?: string[] }, timeoutMs = AUTH_TIMEOUT_MS): Promise<boolean | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      const child = execFile(cmd.command, [...(cmd.prefixArgs ?? []), 'auth', 'status'], { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (_err, stdout) => {
        // A logged-out CLI may exit with an error code and still print the JSON.
        finish(parseLoggedIn(String(stdout ?? '')));
      });
      child.stdin?.end();
      child.on('error', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

/** loggedIn from the printed JSON (the first {...} block), or null. */
export function parseLoggedIn(out: string): boolean | null {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(out.slice(start, end + 1)) as { loggedIn?: unknown };
    return typeof v.loggedIn === 'boolean' ? v.loggedIn : null;
  } catch {
    return null;
  }
}
