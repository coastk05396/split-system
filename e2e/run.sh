#!/bin/sh
# Every worktree shares /tmp/wrangler-e2e-* and ports 8787/8788, so one run per machine: the lock is
# held from the state wipe through Playwright. shortcut: needs util-linux flock, present on Linux CI and WSL.
set -e
exec 9>/tmp/split-e2e.lock
if ! flock -n 9; then
  echo "Another pnpm e2e is running on this machine (it holds /tmp/split-e2e.lock). Wait for it to finish." >&2
  exit 1
fi
node e2e/ports-free.mjs
rm -rf /tmp/wrangler-e2e-8787 /tmp/wrangler-e2e-8788
VITE_TEST_SIGN_IN=1 pnpm build
(
  cd apps/worker
  echo y | pnpm exec wrangler d1 migrations apply DB --local --persist-to /tmp/wrangler-e2e-8787
  echo y | pnpm exec wrangler d1 migrations apply DB --local --persist-to /tmp/wrangler-e2e-8788
)
node ./node_modules/@playwright/test/cli.js test --config=e2e/playwright.config.ts "$@"
