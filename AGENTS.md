# Project guide

- Keep changes focused on the user's request and follow the existing TypeScript and UI patterns.
- Start the local app with `pnpm dev` from the repository root. Open the web UI at `http://localhost:5173`.
- Run checks relevant to the change. Available commands are `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm e2e`.
- Do not run `pnpm e2e` while `pnpm dev` is running; they use the same local ports.
- Do not push to `main` or trigger CI without the user's approval.
