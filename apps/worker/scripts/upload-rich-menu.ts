/**
 * Uploads the default Rich Menu and makes it the default for every user (decision 14).
 * Run by hand once the Messaging API channel exists; nothing runs it automatically.
 *
 *   LINE_CHANNEL_ACCESS_TOKEN=... LIFF_ID=... \
 *     node --experimental-strip-types scripts/upload-rich-menu.ts <menu-image.png|jpg>
 *
 * `--print` prints the menu JSON and calls nothing. The image must be 2500 x 1686 and
 * under 1 MB. The token comes from the environment only; never commit it.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { argv, env, exit } from "node:process";
import { richMenu } from "../src/line/rich-menu.ts";

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    console.error(`Set ${name} in the environment.`);
    exit(1);
  }
  return value;
}

async function call(url: string, token: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok)
    throw new Error(`${init.method ?? "GET"} ${url} -> ${res.status} ${await res.text()}`);
  return res;
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const menu = richMenu(required("LIFF_ID"));
  if (args.includes("--print")) {
    console.log(JSON.stringify(menu, null, 2));
    return;
  }
  const imagePath = args[0];
  if (imagePath === undefined) {
    console.error("Usage: upload-rich-menu.ts <menu-image.png|jpg> (or --print)");
    exit(1);
  }
  const token = required("LINE_CHANNEL_ACCESS_TOKEN");
  const contentType = extname(imagePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";

  const created = await call(`${API}/richmenu`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(menu),
  });
  const { richMenuId } = (await created.json()) as { richMenuId: string };
  await call(`${DATA_API}/richmenu/${richMenuId}/content`, token, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: await readFile(imagePath),
  });
  await call(`${API}/user/all/richmenu/${richMenuId}`, token, { method: "POST" });
  console.log(`Default Rich Menu set: ${richMenuId}`);
}

await main();
