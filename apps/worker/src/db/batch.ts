import type { SQLWrapper } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Db } from "./client.js";

const dialect = new SQLiteSyncDialect();

/**
 * Runs statements as one D1 batch (one transaction) and returns D1's raw results, so each
 * statement's `meta.changes` can be read. Drizzle's own `db.batch` cannot take a raw `sql`
 * statement with bound parameters, which guarded `INSERT ... SELECT ... WHERE` writes need.
 */
export function runBatch(db: Db, statements: readonly SQLWrapper[]): Promise<D1Result[]> {
  const d1 = db.$client;
  return d1.batch(
    statements.map((statement) => {
      const query = dialect.sqlToQuery(statement.getSQL());
      return d1.prepare(query.sql).bind(...query.params);
    }),
  );
}
