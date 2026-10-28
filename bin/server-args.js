"use strict";

// Pure server-argument resolution for the `pi-web` launcher.
//
// Kept in its own CommonJS module so it can be unit tested without starting
// Next.js, and so `bin/pi-web.js` stays a thin spawn wrapper.
//
// SECURITY: this server exposes unauthenticated `/api/*` routes that write
// files and run git commands. It must therefore listen on loopback by default
// (`docs/adr/0004-security-and-permissions.md`). Exposing it to the LAN is an
// explicit opt-in via `--hostname` or `PI_WEB_HOST`.
//
// `HOSTNAME` from the environment is deliberately ignored: on Windows/macOS
// shells it is often the machine name, which would make `next start` bind a
// non-loopback interface by accident.

const DEFAULT_PORT = "30141";
const DEFAULT_HOST = "127.0.0.1";

/**
 * @param {{ cliPort?: string, cliHost?: string, env?: Record<string, string | undefined> }} input
 * @returns {{ port: string, hostname: string, nextArgs: string[] }}
 */
function resolveServerArgs(input) {
  const { cliPort, cliHost, env } = input ?? {};
  const environment = env ?? {};

  const port = cliPort ?? environment.PORT ?? DEFAULT_PORT;
  const hostname = cliHost ?? environment.PI_WEB_HOST ?? DEFAULT_HOST;

  // `-H` is always passed explicitly so Next never falls back to 0.0.0.0.
  return { port, hostname, nextArgs: ["start", "-p", port, "-H", hostname] };
}

module.exports = { resolveServerArgs, DEFAULT_HOST, DEFAULT_PORT };
