import { describe, expect, it } from "vitest";
import { liffLink } from "./liff-link.js";

describe("liffLink", () => {
  it("moves the path and query of the page under the LIFF address", () => {
    expect(liffLink("https://split.example/join/tok-1?a=b", "123-abc")).toBe(
      "https://liff.line.me/123-abc/join/tok-1?a=b",
    );
  });

  it("keeps the plain address without a LIFF ID", () => {
    expect(liffLink("https://split.example/join/tok-1", undefined)).toBe(
      "https://split.example/join/tok-1",
    );
    expect(liffLink("https://split.example/join/tok-1", "")).toBe(
      "https://split.example/join/tok-1",
    );
  });
});
