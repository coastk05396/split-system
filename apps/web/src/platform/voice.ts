/** The longest a 語音搜尋 recording may run; the worker enforces the same ceiling by size. */
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
  /** Rejects when the microphone is denied or unusable. `onLevel` gets the loudness, 0 to 1. */
  start(onLevel: (level: number) => void): Promise<Recording>;
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
    async start(onLevel) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 32 kbit/s keeps 15 s far below the worker's 1 MB ceiling.
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        chunks.push(event.data);
      };
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
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
      const release = () => {
        cancelAnimationFrame(frame);
        for (const track of stream.getTracks()) track.stop();
        void context.close();
      };
      recorder.start();
      return {
        stop: () =>
          new Promise<Blob>((resolve) => {
            recorder.onstop = () => {
              release();
              resolve(new Blob(chunks, { type: recorder.mimeType }));
            };
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
