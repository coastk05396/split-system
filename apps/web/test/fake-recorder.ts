import type { VoiceRecorder } from "../src/platform/voice.js";

/** A microphone that records nothing and counts what the app does with it. */
export function createFakeRecorder(options: { denied?: boolean } = {}) {
  const log = { started: 0, stopped: 0, cancelled: 0, open: 0 };
  let onFail: (() => void) | undefined;
  const recorder: VoiceRecorder = {
    start: (onLevel, fail) => {
      onFail = fail;
      log.started += 1;
      if (options.denied) return Promise.reject(new Error("NotAllowedError"));
      log.open += 1;
      onLevel(0.5);
      return Promise.resolve({
        stop: () => {
          log.stopped += 1;
          log.open -= 1;
          return Promise.resolve(new Blob(["voice"], { type: "audio/webm" }));
        },
        cancel: () => {
          log.cancelled += 1;
          log.open -= 1;
        },
      });
    },
  };
  /** The recorder breaks after it started: the microphone goes off and the app is told. */
  const breakDown = () => {
    log.open -= 1;
    onFail?.();
  };
  return { recorder, log, breakDown };
}
