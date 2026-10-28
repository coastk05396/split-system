import { newApi } from "./api.js";

export const app = newApi().get("/health", (c) => c.json({ status: "ok" as const }, 200));

/** Route types for the SPA's typed client (`hc<AppType>`). */
export type AppType = typeof app;
