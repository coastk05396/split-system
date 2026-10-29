# Instructions for AI Agents

## CI / GitHub Actions Guardrail

- **DO NOT push to `main` unless explicitly instructed to by the user ("push to main" or explicit confirmation).**
  - GitHub Actions CI consumes limited runner minutes on every trigger.
  - Work on feature branches or PR branches (e.g. `build/v1`).
  - Do not automatically push commits or trigger CI runs without user approval.

## Testing & Quality Assurance

- Run checks locally before asking or completing work:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm e2e`
- Ensure tests pass locally without relying on CI runners for debugging.

## Local development and phone testing

- Start everything with one command from the repo root: `pnpm dev`.
  - It creates `apps/worker/.dev.vars` from `.dev.vars.example` if missing, applies the local D1 migrations, then starts the Worker API on `8787` and the Vite frontend on `5173` (Vite proxies `/api` to `8787`).
  - Open `http://localhost:5173`, not `8787` (the Worker port serves the API only).
  - Sign in with the **測試登入（僅限本機）** form; it needs `TEST_SIGN_IN=1`, which `.dev.vars` sets.
- After a change to a not-yet-released migration or the DB schema, the old local database is stale: stop `pnpm dev`, run `rm -rf apps/worker/.wrangler/state`, start it again. Wrangler skips migration filenames it already applied, so edited files are not re-run.
- Same Wi-Fi phone test: open `http://<LAN IP>:5173` (Vite listens on the network via `vite --host`). On WSL2 with `networkingMode=mirrored`, Windows may block it; the README has the one-time firewall command.
- Phone test over the internet (any network, no firewall change): use a Cloudflare quick tunnel.
  1. `pnpm dev` must already be running.
  2. Run `cloudflared tunnel --url http://localhost:5173` (run it in the background and read the log for the address).
  3. Open the printed `https://<random-words>.trycloudflare.com` on the phone. The address changes every run, no account is needed, and `apps/web/vite.config.ts` already allows `*.trycloudflare.com`.
  4. A new name can take a few seconds to resolve. If this machine cannot resolve it but the phone can, check with `curl --doh-url https://1.1.1.1/dns-query <url>`.
  5. **Stop the tunnel when done** (`pkill -f "cloudflared tunnel"`). While it runs, the address is public and the test sign-in form lets anyone who has the link sign in as any name on your local database. Share the link with no one, and never use real data.
- Do not run `pnpm e2e` while `pnpm dev` is running: both want ports `8787` and `8788`. Stop `pnpm dev` first.
