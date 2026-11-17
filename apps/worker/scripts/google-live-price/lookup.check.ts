import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FlightCandidate } from "../../src/flights/pipeline.ts";
import { pythonLiveLookup } from "./lookup.ts";

void test("the Python lookup preserves the adapter's retry flag", async () => {
  const dir = await mkdtemp(join(tmpdir(), "split-google-lookup-"));
  const fakePython = join(dir, "python");
  try {
    await writeFile(
      fakePython,
      '#!/bin/sh\ncat >/dev/null\nprintf \'%s\\n\' \'[{"id":"test","reason":"error","errorReason":"server_error","retried":true,"itineraries":[]}]\'\n',
      { mode: 0o700 },
    );
    const candidate: FlightCandidate = {
      id: "test",
      origin: "TPE",
      dest: "NRT",
      tripType: "ow",
      outDate: "2026-12-10",
      inDate: null,
      priceTwd: 5000,
      airlines: ["IT"],
      transfers: 0,
      returnTransfers: null,
      outboundDep: null,
      inboundDep: null,
    };
    const [result] = await pythonLiveLookup(fakePython)([candidate], { allowRetry: true });
    assert.equal(result?.retried, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
