// Fails when the first-load JavaScript of the built SPA exceeds 200 KB gzipped
// (decision 20). Run after `vite build`: `node scripts/check-bundle-size.ts`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { firstLoadFiles, type Manifest } from "./first-load.ts";

const LIMIT_BYTES = 200 * 1024;
const dist = join(import.meta.dirname, "..", "dist");

const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8")) as Manifest;

const sizes = firstLoadFiles(manifest).map((file) => ({
  file,
  gzip: gzipSync(readFileSync(join(dist, file)), { level: 9 }).length,
}));
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

for (const { file, gzip } of sizes) console.log(`${kb(gzip).padStart(10)}  ${file}`);
const js = sizes.filter(({ file }) => file.endsWith(".js")).reduce((sum, s) => sum + s.gzip, 0);
console.log(`First-load JavaScript: ${kb(js)} gzipped (limit ${kb(LIMIT_BYTES)})`);

if (js > LIMIT_BYTES) {
  console.error("First-load JavaScript is over budget.");
  process.exit(1);
}
