# Project guide

- Keep changes focused on the user's request and follow the existing TypeScript and UI patterns.
- Start the local app with `pnpm dev` from the repository root. Open the web UI at `http://localhost:5173`.
- Run checks relevant to the change: use `pnpm typecheck` and `pnpm test` for quick feedback; run `pnpm e2e` only for full-flow or critical UI/sync changes.
- Work test-first (`tdd` skill) for new logic and bug fixes: confirm the seams with the user, then one failing test (see it fail for the right reason) → smallest change to pass → repeat.
- No new test needed for: deleting dead code, pure refactors, docs/comments, styling-only changes. Existing tests must still pass.
- Do not run `pnpm e2e` while `pnpm dev` is running; they use the same local ports.
- Do not push to `main` or trigger CI without the user's approval.
- Record user-visible behaviour and rules in `docs/SPEC.md` (with the requirement ids W-n / M-n) in the same change, so code review has a written spec to check against.
- Code review must be done by a subagent or another agent, never by the agent that wrote the change. The reviewer runs `/code-review`, `/ponytail:ponytail-review` or `/ponytail:ponytail-audit` and checks the change against `docs/SPEC.md`. The author may fix findings but never signs off on their own change.
- Run `pnpm lint` as well as `pnpm typecheck` and `pnpm test`: CI runs lint, and it is not part of the other two.
- Format only the files you changed (`prettier --write <files>`), never a whole folder: some files in the repo are not prettier-clean on purpose and must not be touched.
