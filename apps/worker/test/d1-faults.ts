import { env } from "cloudflare:workers";

/** Refuse directory updates until the returned cleanup restores D1 writes. */
export async function failDirectoryWrites(): Promise<() => Promise<void>> {
  await env.DB.prepare(`CREATE TRIGGER test_fail_group_directory BEFORE UPDATE ON group_directory
    BEGIN SELECT RAISE(ABORT, 'injected D1 outage'); END`).run();
  return async () => {
    await env.DB.exec("DROP TRIGGER IF EXISTS test_fail_group_directory");
  };
}
