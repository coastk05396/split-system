import type { D1Migration } from "cloudflare:test";
import type { Bindings } from "../src/env.js";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/index.js");
    }
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
