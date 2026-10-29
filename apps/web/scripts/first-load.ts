/** One chunk in Vite's `.vite/manifest.json`. */
export interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

export type Manifest = Record<string, ManifestChunk>;

/**
 * True when a built chunk holds Zod's runtime. The schemas are for the Worker and for forms
 * on lazy pages; a plain constant imported from a schema module drags them into first load
 * (24 KB gzipped at the time of writing), which the 200 KB budget alone would not notice.
 */
export function bundlesZod(source: string): boolean {
  return source.includes("_zod") && source.includes("invalid_type");
}

/**
 * The files a browser must fetch before the first screen renders: every entry chunk,
 * its static imports (transitively) and their CSS. Lazy route chunks are left out.
 */
export function firstLoadFiles(manifest: Manifest): string[] {
  const seen = new Set<string>();
  const files = new Set<string>();

  function visit(key: string): void {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (chunk === undefined) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const imported of chunk.imports ?? []) visit(imported);
  }

  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.isEntry === true) visit(key);
  }
  return [...files];
}
