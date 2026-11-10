/** The longest a 語音搜尋 recording may run. Only the app enforces it; the worker bounds cost by size (1 MB) and rate (6 a minute). */
export const MAX_RECORDING_SECONDS = 15;

/** One recording in progress. */
export interface Recording {
  /** Ends the recording and resolves with what was said. */
  stop(): Promise<Blob>;
  /** Throws the recording away; nothing is sent anywhere. */
  cancel(): void;
}

/** The microphone behind 語音搜尋; tests pass a fake, like the other browser seams. */
export interface VoiceRecorder {
  /**
   * Rejects when the microphone is denied or unusable. `onLevel` gets the loudness, 0 to 1.
   * `onFail` runs once if the recorder breaks after it started (the microphone is already off then).
   */
  start(onLevel: (level: number) => void, onFail?: () => void): Promise<Recording>;
}

/** The browser's microphone, or undefined where it cannot record (some in-app browsers). */
export function createVoiceRecorder(): VoiceRecorder | undefined {
  if (
    typeof navigator === "undefined" ||
    !("mediaDevices" in navigator) ||
    typeof navigator.mediaDevices.getUserMedia !== "function" ||
    typeof MediaRecorder === "undefined"
  )
    return undefined;
  return {
    async start(onLevel, onFail) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let recorder: MediaRecorder;
      let context: AudioContext | undefined;
      let analyser: AnalyserNode;
      const chunks: Blob[] = [];
      try {
        // 32 kbit/s keeps 15 s far below the worker's 1 MB ceiling.
        recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32_000 });
        recorder.ondataavailable = (event) => {
          chunks.push(event.data);
        };
        context = new AudioContext();
        // A context made after the permission prompt can start suspended; the bars need it running.
        void context.resume().catch(() => undefined);
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(stream).connect(analyser);
        recorder.start();
      } catch (error) {
        // Setup failed after the microphone opened: switch the indicator off before giving up.
        for (const track of stream.getTracks()) track.stop();
        void context?.close().catch(() => undefined);
        throw error;
      }
      const samples = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const measure = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
        frame = requestAnimationFrame(measure);
      };
      frame = requestAnimationFrame(measure);
      let failed = false;
      // Set while a stop is waiting for the recorder's last data; an error then rejects it.
      let rejectStop: ((error: Error) => void) | undefined;
      recorder.onerror = () => {
        if (failed) return;
        failed = true;
        release();
        rejectStop?.(new Error("recorder failed"));
        onFail?.();
      };
      const release = () => {
        cancelAnimationFrame(frame);
        for (const track of stream.getTracks()) track.stop();
        void context.close().catch(() => undefined);
      };
      return {
        stop: () =>
          new Promise<Blob>((resolve, reject) => {
            if (failed) {
              reject(new Error("recorder failed"));
              return;
            }
            rejectStop = reject;
            const finish = () => {
              // The stop event can follow an error; what was recorded is then incomplete.
              if (failed) {
                reject(new Error("recorder failed"));
                return;
              }
              release();
              resolve(new Blob(chunks, { type: recorder.mimeType }));
            };
            // A recorder the system already stopped (call, unplugged mic) fires no second stop event.
            if (recorder.state === "inactive") {
              finish();
              return;
            }
            recorder.onstop = finish;
            recorder.stop();
          }),
        cancel: () => {
          recorder.onstop = null;
          if (recorder.state !== "inactive") recorder.stop();
          release();
        },
      };
    },
  };
}
