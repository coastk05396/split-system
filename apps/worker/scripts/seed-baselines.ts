/**
 * Seeds or refreshes the Route Baselines (Google Flights typical price range) in D1.
 *
 *   SERPAPI_KEY_BASELINE=... pnpm --filter @split/worker seed-baselines -- --dry-run
 *   SERPAPI_KEY_BASELINE=... pnpm --filter @split/worker seed-baselines -- --remote
 *   SERPAPI_KEY_BASELINE=... pnpm --filter @split/worker seed-baselines -- --remote --all
 *
 * Fetches the core Routes that have no Baseline under 30 days old in the target D1 (one SerpApi request
 * each, all on the Baseline key, which the daily cron shares); `--all` fetches all 50 again. Defaults to
 * local D1 unless `--remote` is passed. Never commit the key.
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

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
      const tsSpecifier = `${specifier.slice(0, -3)}.ts`;
      if (existsSync(fileURLToPath(new URL(tsSpecifier, context.parentURL)))) {
        return nextResolve(tsSpecifier, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

async function main(): Promise<void> {
  const {
    CORE_BASELINE_ROUTES,
    fetchTypicalRanges,
    formatBaselineSql,
    freshBaselinesSql,
    parseWranglerBaselines,
    staleBaselineRoutes,
  } = await import("../src/flights/baselines.ts");

  const cliArgs = argv.slice(2);
  const dryRun = cliArgs.includes("--dry-run");
  const remote = cliArgs.includes("--remote");
  const envFlagIdx = cliArgs.indexOf("--env");
  const remoteEnv = envFlagIdx >= 0 ? (cliArgs[envFlagIdx + 1] ?? "") : "production";
  if (remoteEnv === "" || remoteEnv.startsWith("-") || (envFlagIdx >= 0 && !remote)) {
    console.error("Use --env <name> only together with --remote.");
    exit(1);
  }
  const key = env["SERPAPI_KEY_BASELINE"];
  if (key === undefined || key === "") {
    console.error("Set SERPAPI_KEY_BASELINE in the environment.");
    exit(1);
  }

  const now = Date.now();
  const targetFlags = remote ? ["--remote", "--env", remoteEnv] : ["--local"];
  let routes = CORE_BASELINE_ROUTES;
  if (!cliArgs.includes("--all")) {
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
    routes = staleBaselineRoutes(CORE_BASELINE_ROUTES, parseWranglerBaselines(stdout));
    if (routes.length === 0) {
      console.info("Every core Route has a Baseline under 30 days old; nothing to fetch.");
      return;
    }
  }
  const ranges = await fetchTypicalRanges({ SERPAPI_KEY_BASELINE: key }, routes, now);
  console.info(
    JSON.stringify({
      event: "seed_baselines_fetched",
      routes: routes.length,
      fetched: ranges.length,
    }),
  );
  if (ranges.length === 0) {
    console.error("SerpApi returned no typical price range; D1 is left untouched.");
    exit(1);
  }

  const sql = formatBaselineSql(ranges, now);
  if (dryRun) {
    const sqlOut = cliArgs.find((a) => a.startsWith("--sql-file="))?.slice("--sql-file=".length);
    if (sqlOut) await writeFile(sqlOut, sql, "utf8");
    else console.log(sql);
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "split-baselines-"));
  const sqlFile = join(dir, "baselines.sql");
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
