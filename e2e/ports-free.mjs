// `pnpm e2e` deletes its local D1 state before Playwright checks ports, so check them first:
// a second run (any worktree) or a `pnpm dev` on 8787 would otherwise lose its database mid-run.
import { createServer } from "node:net";

const taken = await Promise.all(
  [8787, 8788].map(
    (port) =>
      new Promise((resolve) => {
        const server = createServer()
          .once("error", () => resolve(port))
          .listen({ port, host: "::" }, () => server.close(() => resolve(null)));
      }),
  ),
);
const busy = taken.filter((port) => port !== null);
if (busy.length > 0) {
  console.error(
    `Port ${busy.join(" and ")} is in use: another pnpm dev or pnpm e2e is running on this machine. Stop it first.`,
  );
  process.exit(1);
}
