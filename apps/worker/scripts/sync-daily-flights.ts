/**
 * Manually runs the daily SerpApi Explore sync (the Worker cron's job) and writes it into D1.
 *
 *   SERPAPI_KEY_SHORT=... SERPAPI_KEY_LONG=... SERPAPI_KEY_LONG2=... pnpm --filter @split/worker sync-flights -- --dry-run
 *   SERPAPI_KEY_SHORT=... SERPAPI_KEY_LONG=... SERPAPI_KEY_LONG2=... pnpm --filter @split/worker sync-flights -- --remote
 *
 * Runs the Explore roles (short-haul, long-haul and long2); the Baseline key is only for the cron and
 * the seed CLI, so it is ignored here (setting all four variables is fine). A missing role is skipped,
 * as in the cron. Defaults to local D1 (`--local`) unless `--remote` is passed. Never commit the keys.
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

async function main(): Promise<void> {
  installTsExtensionHook();
  const { collectDailyFlights, formatDailyFlightsSyncSql, logDailyFlightsSummary } =
    await import("../src/flights/pipeline.ts");
  const { serpApiFlightSource } = await import("../src/flights/serpapi.ts");
  const { freshBaselinesSql, parseWranglerBaselines } = await import("../src/flights/baselines.ts");

  const cliArgs = argv.slice(2);
  const args = new Set(cliArgs);
  const dryRun = args.has("--dry-run");
  const remote = args.has("--remote");
  const envFlagIdx = cliArgs.indexOf("--env");
  let remoteEnv = "production";
  if (envFlagIdx >= 0) {
    if (!remote) {
      console.error("--env requires --remote.");
      exit(1);
    }
    const envArg = cliArgs[envFlagIdx + 1];
    if (!envArg || envArg.startsWith("-")) {
      console.error("Missing environment name after --env (e.g. --env production).");
      exit(1);
    }
    remoteEnv = envArg;
  }
  const roleKeys = {
    ...(env["SERPAPI_KEY_SHORT"] ? { SERPAPI_KEY_SHORT: env["SERPAPI_KEY_SHORT"] } : {}),
    ...(env["SERPAPI_KEY_LONG"] ? { SERPAPI_KEY_LONG: env["SERPAPI_KEY_LONG"] } : {}),
    ...(env["SERPAPI_KEY_LONG2"] ? { SERPAPI_KEY_LONG2: env["SERPAPI_KEY_LONG2"] } : {}),
  };
  if (Object.keys(roleKeys).length === 0) {
    console.error(
      "Set SERPAPI_KEY_SHORT, SERPAPI_KEY_LONG and/or SERPAPI_KEY_LONG2 in the environment.",
    );
    exit(1);
  }
  const now = Date.now();

  const targetFlags = remote ? ["--remote", "--env", remoteEnv] : ["--local"];
  // Score against the target D1's fresh Baselines (seed-baselines), as the cron does; a dry run may
  // fall back to no Baselines when the target cannot be read (no Deal Signal), a real sync must not.
  const resolveBaselines = async (): Promise<ReadonlyMap<string, number>> => {
    try {
      const { stdout } = await execFileAsync("pnpm", [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        ...targetFlags,
        "--json",
        "--command",
        freshBaselinesSql(now),
      ]);
      return parseWranglerBaselines(stdout);
    } catch (error) {
      if (!dryRun) throw error;
      console.warn("Could not read flight_baselines from D1; dry run has no Deal Signal.");
      return new Map();
    }
  };
  const collected = await collectDailyFlights(serpApiFlightSource(roleKeys), now, resolveBaselines);
  logDailyFlightsSummary("manual_daily_flights_collected", collected);
  if (!collected.completed) {
    console.error("SerpApi answered no query; D1 is left untouched.");
    exit(1);
  }

  const sql = formatDailyFlightsSyncSql(collected.rows, {
    digestDate: collected.digestDate,
    at: now,
  });
  if (dryRun) {
    // `--sql-file=` keeps the SQL apart from the log lines.
    const sqlOut = cliArgs.find((a) => a.startsWith("--sql-file="))?.slice("--sql-file=".length);
    if (sqlOut) await writeFile(sqlOut, sql, "utf8");
    else console.log(sql);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "split-flights-sync-"));
  const sqlFile = join(dir, "sync.sql");
  try {
    await writeFile(sqlFile, sql, "utf8");
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
