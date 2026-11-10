import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceRecorder } from "./voice.js";

/** Browser stand-ins that count what the recorder does with the microphone. */
function stubBrowser(options: { recorderThrows?: boolean } = {}) {
  const log = { tracksStopped: 0, contextsClosed: 0 };
  const stream = {
    getTracks: () => [
      {
        stop: () => {
          log.tracksStopped += 1;
        },
      },
    ],
  };
  const recorders: FakeMediaRecorder[] = [];
  class FakeMediaRecorder {
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      if (options.recorderThrows) throw new Error("NotSupportedError");
      recorders.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["x"]) });
      this.onstop?.();
    }
  }
  class FakeAudioContext {
    createAnalyser() {
      return { fftSize: 0, getByteTimeDomainData: () => undefined };
    }
    createMediaStreamSource() {
      return { connect: () => undefined };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      log.contextsClosed += 1;
      return Promise.resolve();
    }
  }
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve(stream) },
  });
  return { log, recorders };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createVoiceRecorder", () => {
  it("switches the microphone off when the recorder cannot be created", async () => {
    const { log } = stubBrowser({ recorderThrows: true });
    await expect(createVoiceRecorder()?.start(() => undefined)).rejects.toThrow();
    expect(log.tracksStopped).toBe(1);
  });

  it("switches the microphone off and tells the app when the recorder breaks after it started", async () => {
    const { log, recorders } = stubBrowser();
    const onFail = vi.fn();
    const recording = await createVoiceRecorder()?.start(() => undefined, onFail);
    recorders[0]?.onerror?.();
    expect(log).toEqual({ tracksStopped: 1, contextsClosed: 1 });
    expect(onFail).toHaveBeenCalledTimes(1);
    await expect(recording?.stop()).rejects.toThrow();
  });

  it("rejects a stop that is waiting when the recorder breaks, instead of handing back partial audio", async () => {
    const { log, recorders } = stubBrowser();
    const recording = await createVoiceRecorder()?.start(() => undefined);
    const recorder = recorders[0];
    if (!recorder) throw new Error("no recorder");
    // The browser reports the error before it delivers the stop event.
    recorder.stop = () => {
      recorder.state = "inactive";
      recorder.ondataavailable?.({ data: new Blob(["partial"]) });
    };
    const stopping = recording?.stop();
    recorder.onerror?.();
    recorder.onstop?.();
    await expect(stopping).rejects.toThrow();
    expect(log.tracksStopped).toBeGreaterThanOrEqual(1);
  });

  it("hands back what was recorded on stop and releases the microphone once", async () => {
    const { log } = stubBrowser();
    const recording = await createVoiceRecorder()?.start(() => undefined);
    const blob = await recording?.stop();
    expect(blob?.size).toBe(1);
    expect(log).toEqual({ tracksStopped: 1, contextsClosed: 1 });
  });

  it("resolves a stop on a recorder the system already stopped", async () => {
    const { log, recorders } = stubBrowser();
    const recording = await createVoiceRecorder()?.start(() => undefined);
    if (recorders[0]) recorders[0].state = "inactive";
    await expect(recording?.stop()).resolves.toBeInstanceOf(Blob);
    expect(log.tracksStopped).toBe(1);
  });
});
