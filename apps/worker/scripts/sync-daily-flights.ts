/**
 * Manually runs the daily SerpApi Explore sync (the Worker cron's job) and writes it into D1.
 *
 *   SERPAPI_KEYS=key1,key2 pnpm --filter @split/worker sync-flights -- --dry-run
 *   SERPAPI_KEYS=key1,key2 pnpm --filter @split/worker sync-flights -- --remote
 *
 * Defaults to local D1 (`--local`) unless `--remote` is passed. Never commit the keys.
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

function requireEnv(name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    console.error(`Set ${name} in the environment.`);
    exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  installTsExtensionHook();
  const { collectDailyFlights, formatDailyFlightsSyncSql, logDailyFlightsSummary } =
    await import("../src/flights/pipeline.ts");
  const { serpApiFlightSource } = await import("../src/flights/serpapi.ts");

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
  const keys = requireEnv("SERPAPI_KEYS");
  const now = Date.now();

  const collected = await collectDailyFlights(serpApiFlightSource({ SERPAPI_KEYS: keys }), now);
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
    const targetFlags = remote ? ["--remote", "--env", remoteEnv] : ["--local"];
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
