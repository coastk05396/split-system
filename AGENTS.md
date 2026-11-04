# Project guide

- Keep changes focused on the user's request and follow the existing TypeScript and UI patterns.
- Start the local app with `pnpm dev` from the repository root. Open the web UI at `http://localhost:5173`.
- Run checks relevant to the change: use `pnpm typecheck` and `pnpm test` for quick feedback; run `pnpm e2e` only for full-flow or critical UI/sync changes.
- Work test-first (`tdd` skill) for new logic and bug fixes: confirm the seams with the user, then one failing test (see it fail for the right reason) → smallest change to pass → repeat.
- No new test needed for: deleting dead code, pure refactors, docs/comments, styling-only changes. Existing tests must still pass.
- Do not run `pnpm e2e` while `pnpm dev` is running; they use the same local ports.
- Do not push to `main` or trigger CI without the user's approval.
- Staging domain: `https://split-stag.rickchen.si`. Vite `allowedHosts` lists only it; Google's authorized redirect URI there is `https://split-stag.rickchen.si/google-return`.
- A docs-only change needs no CI run: put `[skip ci]` in its commit message.
- Record user-visible behaviour and rules in `docs/SPEC.md` (with the requirement ids W-n / M-n) in the same change, so code review has a written spec to check against.
- Code review is done by a different agent in a fresh context, read-only (no file edits, no git writes), never by the author. Run `/code-review origin/main docs/SPEC.md` in Claude Code; in Codex use the "Code Review" skill (type `$code-review` and pick it) with the same arguments, `origin/main docs/SPEC.md`. When dispatching a reviewer through Orca orchestration, name that skill in the task text. Optional extras: `/ponytail:ponytail-review` (diff), `/ponytail:ponytail-audit` (whole repo). The author fixes findings and never signs off on their own change.
- Run `pnpm lint` as well as `pnpm typecheck` and `pnpm test`: CI runs lint, and it is not part of the other two.
- Format only the files you changed (`prettier --write <files>`), never a whole folder: some files in the repo are not prettier-clean on purpose and must not be touched.

## Account display (Settings)

- The Settings Profile card follows the latest sign-in (`signedInWith`); Google shows its verified email, LINE never has one. Rules W-9 in `docs/SPEC.md`; terms in `GLOSSARY.md` (Profile card, Linked account).
- Showing a Google email is a deliberate exception to the old "never email" rule: keep `privacy.md` and `signIn.dataSummary1/2` (zh-TW and en) in step with `identities.email` whenever it changes.
- Migration `0011_identity_email.sql` deletes all existing Google links; do not apply it to a database unless the user has agreed.
