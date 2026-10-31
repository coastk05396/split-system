import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "./env.js";

export interface SyncNeeded {
  version: 1;
  type: "sync needed";
  rev: number;
  timestamp: number;
}

export class GroupLedger extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.upgrade();
  }

  private upgrade(): void {
    const sql = this.ctx.storage.sql;
    const exists = sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ledger_meta'",
      )
      .toArray();
    if (exists.length === 0) return;
    this.ctx.storage.transactionSync(() => {
      // Future schema upgrades run here for existing Groups.
    });
  }

  override fetch(request: Request): Response {
    if (new URL(request.url).pathname === "/initialise" && request.method === "POST") {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "CREATE TABLE IF NOT EXISTS ledger_meta (schema_version INTEGER NOT NULL, rev INTEGER NOT NULL)",
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO ledger_meta SELECT 1, 0 WHERE NOT EXISTS (SELECT 1 FROM ledger_meta)",
        );
      });
      this.upgrade();
      return new Response(null, { status: 204 });
    }
    if (new URL(request.url).pathname !== "/live") return new Response(null, { status: 404 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const userId = request.headers.get("X-User-Id");
    if (userId === null) return new Response(null, { status: 404 });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.ctx.acceptWebSocket(server, [userId]);
    const headers = new Headers();
    const protocol = request.headers.get("Sec-WebSocket-Protocol");
    if (protocol !== null) headers.set("Sec-WebSocket-Protocol", protocol);
    return new Response(null, { status: 101, webSocket: client, headers });
  }
}
