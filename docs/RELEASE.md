# Release setup for 小芽分帳

The production hostname is `https://split.rickchen.si`. Keep staging and production resources separate. This document prepares a release. Creating resources does not deploy the app; merging to `main` deploys production (see Release gate).

## Values to collect

| Service | Public identifier or setting | Store privately |
| --- | --- | --- |
| Cloudflare | Account ID; active `rickchen.si` zone; D1 IDs for `split-staging` and `split-prod`; KV namespace IDs for each environment | API token for CI |
| Google | OAuth **Web application** client ID for `https://split.rickchen.si` | No client secret is used by this ID-token flow |
| LINE Login | Login channel ID and LIFF app ID, with endpoint `https://split.rickchen.si/` and `openid` scope | Channel secret is not used by the LIFF ID-token flow |
| LINE Messaging API | Messaging API channel and webhook URL `https://split.rickchen.si/api/v1/line/webhook` | Channel secret and channel access token |
| Worker | None | A new, random `SESSION_SIGNING_KEY` for each environment |

Do not put tokens or secrets in GitHub issues, chat, `wrangler.jsonc`, or Vite `VITE_` variables. Set Worker secrets with `pnpm --filter @split/worker exec wrangler secret put NAME --env staging|production`, or the Cloudflare dashboard. The `VITE_` values are shipped to every browser and must be public IDs only.

## Cloudflare

1. In Cloudflare, confirm the `rickchen.si` DNS zone is active. Find the account ID on the account overview page.
2. Authenticate Wrangler locally with `pnpm --filter @split/worker exec wrangler login`. Create the two D1 databases and separate JWKS-cache KV namespaces. Record their IDs without committing account credentials.
3. Replace the placeholder D1 and KV IDs in `apps/worker/wrangler.jsonc`. Each environment needs its own `DB` and `JWKS_CACHE` binding; Wrangler environments do not inherit bindings or vars. Replace the public Google and LINE client-ID placeholders for each environment.
4. Build the SPA, apply migrations to the matching remote D1 database, then deploy **staging**. Check `/api/v1/health`, sign-in, expense entry, settlement, and the test-sign-in route returning 404.
5. Before production deployment, add the custom domain `split.rickchen.si` to the production Worker. The zone must be active in the same Cloudflare account, and that hostname must not have an existing CNAME record. Cloudflare creates DNS and TLS for the Worker custom domain.
6. Create a Cloudflare API token scoped to this account for Worker deployment and D1 migrations. Put it and the account ID in GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Set a rate-limit/WAF rule for `/api/v1/auth/*` before production traffic.

## Google sign-in

In Google Cloud, configure OAuth branding/consent, then create a **Web application** OAuth client. Add `https://split.rickchen.si` to Authorized JavaScript origins; add the staging origin if staging sign-in is needed. This app uses the Google Identity Services JavaScript callback and sends an ID token to the Worker, so an OAuth redirect URI and client secret are not required by the current code. Put the same client ID in the web build as `VITE_GOOGLE_CLIENT_ID` and in the matching Worker environment as `GOOGLE_CLIENT_ID`.

## LINE Login and bot

In LINE Developers, create or select a provider and LINE Login channel. Add a LIFF app with endpoint `https://split.rickchen.si/` and `openid` scope. Put its LIFF ID in the web build as `VITE_LIFF_ID`, and the Login channel ID in the Worker as `LINE_LOGIN_CHANNEL_ID`. Keep staging on a separate LIFF app/endpoint if testing sign-in there.

Create or select a Messaging API channel for the bot. Set the webhook URL to `https://split.rickchen.si/api/v1/line/webhook`, verify it, and enable **Use webhook**. Store the channel secret as the Worker secret `LINE_CHANNEL_SECRET` and its channel access token as `LINE_CHANNEL_ACCESS_TOKEN`. Test with a LINE account that has added the official account as a friend. Do not enable the production webhook until the production Worker is deployed and the secret is set.

## Release gate

Run typecheck, lint, unit/D1 tests, build, bundle-size check, Playwright E2E, actionlint, and secret scanning. Confirm `TEST_SIGN_IN` is absent from deployed Worker vars and secrets; the production-config E2E test requires the route to answer 404. Apply migrations before deploying the Worker. The pull request's CI runs the full gate, including E2E, actionlint and secret scanning; merging to `main` then runs the production workflow, which repeats typecheck, lint and tests, applies D1 migrations and deploys. Check risky changes on staging before merging; the production workflow can still be run by hand.

### Group ledger live connection: real-device check

- On iOS and Android inside LIFF, verify a live connection using the access token in WebSocket subprotocols. If LIFF rejects it, use the short-lived single-use ticket fallback described in the Group ledger spec.
- Send the literal `ping` frame and confirm the runtime answers `pong`.
## Maintenance gate

After the gate is deployed, set `MAINTENANCE` with `pnpm --filter @split/worker exec wrangler secret put MAINTENANCE --env staging` (or `--env production`). Enter the secret interactively. API writes return 503 while the secret is set; reads and health remain available. For verification, send the secret in the `X-Maintenance-Bypass` header over HTTPS, keeping it out of logs and shell history. Remove the gate after verification with `pnpm --filter @split/worker exec wrangler secret delete MAINTENANCE --env staging` (or `--env production`). Do not set or remove the production secret until the owner decides.

## Release 1: Group ledger cutover checklist

For the detailed step-by-step procedure and disaster recovery steps, see `docs/operations/group-ledger-migration.md`. Summary checklist:
1. **Pre-cutover backup**: Export and verify full D1 backup outside the repository.
2. **Maintenance gate**: Activate gate via `MAINTENANCE` secret. Validate 503 on writes, 200 on reads.
3. **Identity verification**: Query candidate ID for 「明天去哪玩」, verify fingerprint via `GET /api/v1/maintenance/migration/snapshot/:id` with bypass.
4. **Deploy**: Apply additive D1 migrations, deploy new Worker with `GROUP_LEDGER` DO binding and SQLite migration `tag: v1`.
5. **Import & verify**: Run `POST /api/v1/maintenance/migration/import/:id` with bypass. Verify all members, zero-sum balances, expenses, settlements, stops, sessions, and auth.
6. **Controlled wipe**: Run `POST /api/v1/maintenance/migration/wipe-excluded/:id` with bypass to remove non-retained groups while preserving all users, identities, and sessions. Re-verify retained group and auth.
7. **Production sign-off & gate removal**: Verify health, live WebSocket, 404 on test sign-in, remove maintenance gate, monitor observability.
