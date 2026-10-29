import { describe, expect, it } from "vitest";
import { firstLoadFiles } from "./first-load.ts";

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
