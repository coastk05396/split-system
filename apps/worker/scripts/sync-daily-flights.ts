/**
 * Manually fetches, verifies, scores, and syncs Travelpayouts daily flights into D1.
 *
 *   TRAVELPAYOUTS_TOKEN=... pnpm --filter @split/worker sync-flights -- --remote
 *   TRAVELPAYOUTS_TOKEN=... pnpm --filter @split/worker sync-flights -- --dry-run
 *
 * Defaults to local D1 (`--local`) unless `--remote` is passed. Never commit the token.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function installTsExtensionHook(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
        const tsSpecifier = `${specifier.slice(0, -3)}.ts`;
        const candidateUrl = new URL(tsSpecifier, context.parentURL);
        if (existsSync(fileURLToPath(candidateUrl))) {
          return nextResolve(tsSpecifier, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    console.error(`Set ${name} in the environment.`);
    exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  installTsExtensionHook();
  const { collectVerifiedDailyFlights, formatDailyFlightsSyncSql, productionFlightSource } =
    await import("../src/flights/pipeline.ts");

  const args = new Set(argv.slice(2));
  const dryRun = args.has("--dry-run") || args.has("--print");
  const remote = args.has("--remote");
  const token = required("TRAVELPAYOUTS_TOKEN");
  const now = Date.now();

  const collected = await collectVerifiedDailyFlights(
    productionFlightSource({ TRAVELPAYOUTS_TOKEN: token }),
    now,
  );
  console.info(
    JSON.stringify({
      event: "manual_daily_flights_collected",
      digestDate: collected.digestDate,
      candidates: collected.candidates,
      droppedNull: collected.droppedNull,
      droppedGhost: collected.droppedGhost,
      persisted: collected.rows.length,
    }),
  );

  const sql = formatDailyFlightsSyncSql(collected.rows);
  if (dryRun) {
    console.log(sql);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "split-flights-sync-"));
  const sqlFile = join(dir, "sync.sql");
  try {
    await writeFile(sqlFile, sql, "utf8");
    const targetFlags = remote ? ["--remote", "--env", "production"] : ["--local"];
    const { stdout, stderr } = await execFileAsync("pnpm", [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      ...targetFlags,
      "--yes",
      "--file",
      sqlFile,
    ]);
    if (stdout) console.log(stdout.trim());
    if (stderr) console.error(stderr.trim());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await main();
