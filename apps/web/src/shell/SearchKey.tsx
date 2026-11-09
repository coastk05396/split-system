import { Search } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { useDeps } from "../app/AppProviders.js";
import { useAuth } from "../auth/AuthProvider.js";
import { readWithRev } from "../groups/data.js";
import { t } from "../i18n/messages.js";
import { MAX_RECORDING_SECONDS, type Recording } from "../platform/voice.js";
import { hapticTick } from "./haptics.js";
import { prefersReducedMotion } from "./motion.js";

/** A hold this long is 語音搜尋; anything shorter is a tap. */
const HOLD_MS = 350;
/** Sliding up this far and letting go cancels the recording. */
const CANCEL_PX = 70;
const BARS = 44;

/** What the Travel page is told when the Search key sends it somewhere. */
export interface SearchKeyHandover {
  /** Open the 搜尋面板. */
  sheet?: boolean;
  /** Explains, inside the sheet, why the microphone was not used. */
  micHint?: boolean;
  /** What the User said; the page searches it as a 小芽 prompt. */
  prompt?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "listening"; left: number; cancelling: boolean }
  | { kind: "recognizing" }
  | { kind: "heard"; text: string; shown: number }
  | { kind: "unheard"; retry: boolean };

interface Hold {
  startY: number;
  started: boolean;
  cancelling: boolean;
  left: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  ticker: ReturnType<typeof setInterval> | undefined;
  recording: Promise<Recording> | undefined;
}

/** Text whose letters flip in like a departure board; read aloud as one piece. */
function Flap({ text }: { text: string }) {
  return (
    <span aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <span
          key={`${text}-${String(i)}`}
          aria-hidden="true"
          className="vx-fl"
          style={{ animationDelay: `${String(i * 45)}ms` }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

function VoicePanel({
  phase,
  level,
  onRetry,
  onClose,
}: {
  phase: Exclude<Phase, { kind: "idle" }>;
  level: number;
  onRetry: (() => void) | undefined;
  onClose: () => void;
}) {
  const listening = phase.kind === "listening";
  const orbScale =
    listening && phase.cancelling
      ? 0.72
      : phase.kind === "recognizing"
        ? 0.64
        : listening
          ? 0.8
          : 0.64;
  return createPortal(
    <div
      className="vx"
      role="dialog"
      aria-label={t("voice.title")}
      data-phase={phase.kind}
      style={{ "--lv": level } as CSSProperties}
    >
      <div className="vx-dim" />
      <div className="vx-panel">
        <div className="vx-scan" aria-hidden="true" />
        <p className="vx-status" role="status">
          {listening && (
            <>
              <Flap text={t("voice.listening")} />
              <span className="vx-left">
                <Flap text={t("voice.left", { n: phase.left })} />
              </span>
            </>
          )}
          {phase.kind === "recognizing" && (
            <span className="vx-glow vx-wave">{t("voice.recognizing")}</span>
          )}
          {phase.kind === "heard" && (
            <span className="vx-glow">
              {Array.from(phase.text.slice(0, phase.shown)).map((ch, i) => (
                <span key={`${String(i)}-${ch}`} className="vx-ch">
                  {ch}
                </span>
              ))}
              <i className="vx-caret" aria-hidden="true" />
            </span>
          )}
          {phase.kind === "unheard" && <span className="vx-glow">{t("voice.unheard")}</span>}
        </p>
        <div className="vx-orbit" aria-hidden="true" style={{ "--s": orbScale } as CSSProperties}>
          <i className="vx-ring" />
          <i className="vx-ring" style={{ animationDelay: "0.8s" }} />
          <i className="vx-ring" style={{ animationDelay: "1.6s" }} />
          {Array.from({ length: BARS }, (_, i) => (
            <i
              key={i}
              className="vx-bar"
              style={
                {
                  "--a": `${String((i * 360) / BARS)}deg`,
                  "--k": 0.45 + ((i * 7) % 11) / 20,
                } as CSSProperties
              }
            />
          ))}
          <i className="vx-orb" />
        </div>
        {listening && (
          <p className="vx-hint">
            {t(phase.cancelling ? "voice.hintCancel" : "voice.hintRelease")}
          </p>
        )}
        {phase.kind === "unheard" && (
          <div className="vx-actions">
            {onRetry && (
              <button type="button" className="vx-btn" onClick={onRetry}>
                {t("voice.retry")}
              </button>
            )}
            <button type="button" className="vx-btn" onClick={onClose}>
              {t("voice.close")}
            </button>
          </div>
        )}
        {listening && <i className="vx-anchor" aria-hidden="true" />}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The middle button of Travel mode. A tap opens the 搜尋面板; a long-press records the User's voice
 * (語音搜尋) and, on release, turns it into text that the Travel page searches. Sliding up before
 * letting go throws the recording away. Where the browser cannot record, a hold is just a tap.
 */
export function SearchKey({ variant }: { variant: "bottom" | "side" }) {
  const { recorder } = useDeps();
  const { session } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [level, setLevel] = useState(0);
  const hold = useRef<Hold | null>(null);
  // The last recording, kept in memory only so that 重試 can resend it; dropped when the panel closes.
  const audio = useRef<Blob | null>(null);

  // On /travel already, replace the entry so Back does not land on the same page twice.
  const go = (handover: SearchKeyHandover) =>
    void navigate("/travel", { state: handover, replace: pathname === "/travel" });
  const close = () => {
    audio.current = null;
    setLevel(0);
    setPhase({ kind: "idle" });
  };

  async function transcribe(blob: Blob) {
    audio.current = blob;
    setPhase({ kind: "recognizing" });
    try {
      const { text } = await readWithRev<{ text: string }>(
        session.fetch("/api/v1/flights/voice", {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm" },
          body: blob,
          signal: AbortSignal.timeout(15_000),
        }),
      );
      const heard = text.trim();
      if (!heard) setPhase({ kind: "unheard", retry: false });
      else setPhase({ kind: "heard", text: heard, shown: 0 });
    } catch {
      setPhase({ kind: "unheard", retry: true });
    }
  }

  // The transcript types itself in, then the search starts by itself.
  const heard = phase.kind === "heard" ? phase.text : null;
  useEffect(() => {
    if (heard === null) return;
    const letters = Array.from(heard);
    const instant = prefersReducedMotion();
    let shown = instant ? letters.length : 0;
    let finish: ReturnType<typeof setTimeout> | undefined;
    const arrive = () => {
      finish = setTimeout(
        () => {
          close();
          go({ prompt: heard });
        },
        instant ? 600 : 900,
      );
    };
    if (instant) {
      setPhase({ kind: "heard", text: heard, shown });
      arrive();
      return () => {
        clearTimeout(finish);
      };
    }
    const typing = setInterval(() => {
      shown += 1;
      setPhase({ kind: "heard", text: heard, shown });
      if (shown >= letters.length) {
        clearInterval(typing);
        arrive();
      }
    }, 70);
    return () => {
      clearInterval(typing);
      clearTimeout(finish);
    };
  }, [heard]);

  // Leaving the page mid-recording must not leave the microphone on.
  useEffect(
    () => () => {
      const h = hold.current;
      if (!h) return;
      clearTimeout(h.timer);
      clearInterval(h.ticker);
      void h.recording
        ?.then((r) => {
          r.cancel();
        })
        .catch(() => undefined);
    },
    [],
  );

  function begin(h: Hold) {
    if (!recorder) return;
    h.started = true;
    hapticTick(20);
    h.left = MAX_RECORDING_SECONDS;
    setPhase({ kind: "listening", left: h.left, cancelling: false });
    h.recording = recorder.start(setLevel);
    h.recording.catch(() => {
      if (hold.current !== h) return;
      clearInterval(h.ticker);
      hold.current = null;
      close();
      go({ sheet: true, micHint: true });
    });
    h.ticker = setInterval(() => {
      h.left -= 1;
      setPhase({ kind: "listening", left: h.left, cancelling: h.cancelling });
      if (h.left <= 0) void release(h, false);
    }, 1000);
  }

  async function release(h: Hold, cancel: boolean) {
    clearTimeout(h.timer);
    clearInterval(h.ticker);
    if (hold.current === h) hold.current = null;
    if (!h.started) {
      // A system gesture that cancels a short touch is not a tap.
      if (!cancel) go({ sheet: true });
      return;
    }
    if (cancel || !h.recording) {
      close();
      void h.recording
        ?.then((r) => {
          r.cancel();
        })
        .catch(() => undefined);
      return;
    }
    setLevel(0);
    setPhase({ kind: "recognizing" });
    let blob: Blob;
    try {
      blob = await (await h.recording).stop();
    } catch {
      close();
      go({ sheet: true, micHint: true });
      return;
    }
    await transcribe(blob);
  }

  const current = pathname === "/travel";
  const label = t("nav.search");
  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      // A second finger or a press during recognition must not orphan the first hold.
      if (event.button !== 0 || hold.current || phase.kind !== "idle") return;
      // Keeps the move and release events on the key while the finger slides up (absent in jsdom).
      if ("setPointerCapture" in event.currentTarget)
        event.currentTarget.setPointerCapture(event.pointerId);
      const h: Hold = {
        startY: event.clientY,
        started: false,
        cancelling: false,
        left: MAX_RECORDING_SECONDS,
        timer: undefined,
        ticker: undefined,
        recording: undefined,
      };
      // Without a recorder a hold is just a tap: only the release does anything.
      if (recorder)
        h.timer = setTimeout(() => {
          begin(h);
        }, HOLD_MS);
      hold.current = h;
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const h = hold.current;
      if (!h?.started) return;
      const cancelling = event.clientY - h.startY < -CANCEL_PX;
      if (cancelling === h.cancelling) return;
      h.cancelling = cancelling;
      setPhase({ kind: "listening", left: h.left, cancelling });
    },
    onPointerUp: () => {
      const h = hold.current;
      if (h) void release(h, h.cancelling);
    },
    onPointerCancel: () => {
      const h = hold.current;
      if (h) void release(h, true);
    },
    // A touch hold would otherwise open the browser's context menu over the panel.
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
    },
    // Keyboard and assistive tech click without a pointer (detail 0): the same as a tap.
    onClick: (event: React.MouseEvent) => {
      if (event.detail === 0) go({ sheet: true });
    },
  };

  const button =
    variant === "bottom" ? (
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        className="group press-pill relative flex flex-1 touch-none flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium select-none focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-sprout-700"
        {...handlers}
      >
        <span
          className={`relative -mt-5 flex size-14 items-center justify-center rounded-full text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_6px_14px_-6px_#143f2a] transition-all duration-300 ease-(--ease-spring) group-active:scale-[0.85] motion-reduce:transition-none motion-reduce:transform-none ${current ? "bg-sprout-600" : "bg-sprout-500"}`}
        >
          <Search aria-hidden="true" className="size-6" strokeWidth={2.4} />
        </span>
        <span className={`relative ${current ? "font-bold text-sprout-700" : "text-ink-muted"}`}>
          {label}
        </span>
      </button>
    ) : (
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        className={`press-pill relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
          current ? "bg-sprout-600 font-bold" : "text-white/85 hover:bg-white/10"
        }`}
        {...handlers}
      >
        <Search aria-hidden="true" className="relative size-5" />
        <span className="relative">{label}</span>
      </button>
    );

  return (
    <>
      {button}
      {phase.kind !== "idle" && (
        <VoicePanel
          phase={phase}
          level={level}
          onClose={close}
          onRetry={
            phase.kind === "unheard" && phase.retry && audio.current
              ? () => {
                  if (audio.current) void transcribe(audio.current);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
