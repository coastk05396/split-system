/**
 * Manually fetches, verifies, scores, and syncs Travelpayouts daily flights into D1.
 *
 *   TRAVELPAYOUTS_TOKEN=... pnpm --filter @split/worker sync-flights -- --remote
 *   TRAVELPAYOUTS_TOKEN=... pnpm --filter @split/worker sync-flights -- --dry-run
 *   ... sync-flights -- --verify=google --profile=actions --dry-run   (Live Price, 1,500-call budget; needs Python deps)
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
  const {
    collectVerifiedDailyFlights,
    formatDailyFlightsSyncSql,
    logDailyFlightsSummary,
    productionFlightSource,
    ACTIONS_UPSTREAM_CALLS,
    MAX_DAILY_UPSTREAM_CALLS,
  } = await import("../src/flights/pipeline.ts");
  const { googleLiveFlightSource } = await import("../src/flights/live-price.ts");
  const { pythonLiveLookup } = await import("./google-live-price/lookup.ts");

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
  const flagValue = (name: string, allowed: readonly string[], fallback: string): string => {
    const value = cliArgs.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    if (value === undefined) return fallback;
    if (!allowed.includes(value)) {
      console.error(`--${name} must be one of: ${allowed.join(", ")}.`);
      exit(1);
    }
    return value;
  };
  const verify = flagValue("verify", ["google", "travelpayouts"], "travelpayouts");
  const profile = flagValue("profile", ["local", "actions"], "local");
  const token = requireEnv("TRAVELPAYOUTS_TOKEN");
  const now = Date.now();

  const base = productionFlightSource(
    { TRAVELPAYOUTS_TOKEN: token },
    undefined,
    undefined,
    profile === "actions" ? ACTIONS_UPSTREAM_CALLS : MAX_DAILY_UPSTREAM_CALLS,
  );
  const source =
    verify === "google"
      ? googleLiveFlightSource(base, pythonLiveLookup(env["GOOGLE_LIVE_PYTHON"] ?? "python3"))
      : base;
  const collected = await collectVerifiedDailyFlights(source, now);
  logDailyFlightsSummary("manual_daily_flights_collected", collected);

  const sql = formatDailyFlightsSyncSql(
    collected.rows,
    collected.completed ? { digestDate: collected.digestDate, at: now } : undefined,
  );
  if (dryRun) {
    // `--sql-file=` keeps the SQL apart from the log lines (the Actions dry run uploads it).
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
