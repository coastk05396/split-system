import { describe, expect, it } from "vitest";
import { bundlesZod, firstLoadFiles } from "./first-load.ts";

describe("firstLoadFiles", () => {
  it("counts the entry and its static imports, not the lazy routes", () => {
    const manifest = {
      "index.html": {
        file: "assets/index-a.js",
        isEntry: true,
        imports: ["_vendor"],
        dynamicImports: ["src/pages/LandingPage.tsx"],
        css: ["assets/index-a.css"],
      },
      _vendor: { file: "assets/vendor-b.js", imports: ["_shared"] },
      _shared: { file: "assets/shared-c.js", imports: ["_vendor"] },
      "src/pages/LandingPage.tsx": { file: "assets/LandingPage-d.js", imports: ["_vendor"] },
    };

    expect(firstLoadFiles(manifest).sort()).toEqual([
      "assets/index-a.css",
      "assets/index-a.js",
      "assets/shared-c.js",
      "assets/vendor-b.js",
    ]);
  });
});

describe("bundlesZod", () => {
  it("spots Zod's runtime in a built chunk, and not ordinary code", () => {
    const zod = "e._zod.check=o=>{o.issues.push({code:`invalid_type`,input:s})}";
    expect(bundlesZod(zod)).toBe(true);
    expect(bundlesZod("const total = items.reduce((sum, x) => sum + x.amount, 0);")).toBe(false);
    // Either marker alone is a coincidence, not the library.
    expect(bundlesZod("const code = `invalid_type`;")).toBe(false);
  });
});
