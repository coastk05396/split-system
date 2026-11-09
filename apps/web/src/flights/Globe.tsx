import { FLIGHT_DESTINATIONS, FLIGHT_ORIGINS, airportCoordinates } from "@split/shared";
import { useEffect, useRef } from "react";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { airportName } from "./AirportPicker.js";

const SIZE = 100; // CSS px; the canvas has twice the pixels
// The reference mock draws at 118 px with R = 0.36 of the box and 1.8 px dots; these are those values in SIZE units.
const R = 36;
const DOT = 1.8 * (SIZE / 118);
const PLANE_PATH =
  "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z";
const AIRPORT_DOTS = [...FLIGHT_ORIGINS, ...FLIGHT_DESTINATIONS]
  .map((a) => airportCoordinates(a.airport))
  .filter((p): p is Point => p !== undefined);
const RAD = Math.PI / 180;
// Where the globe faces before it has been told anywhere: Taiwan.
const HOME = { lat: 23.7, lng: 121 };

interface Point {
  lat: number;
  lng: number;
}

interface View {
  centre: Point;
  /** The marker's size, 0 to 1: it grows as the globe arrives. */
  marker: number;
  target: Point | undefined;
  /** Where the route starts, for the arc. */
  from: Point | undefined;
}

/** Orthographic projection: screen offset in -1..1 and whether the point faces us. */
function project(lat: number, lng: number, c: Point) {
  const dLng = (lng - c.lng) * RAD;
  const cosC =
    Math.sin(c.lat * RAD) * Math.sin(lat * RAD) +
    Math.cos(c.lat * RAD) * Math.cos(lat * RAD) * Math.cos(dLng);
  return {
    x: Math.cos(lat * RAD) * Math.sin(dLng),
    y:
      Math.cos(c.lat * RAD) * Math.sin(lat * RAD) -
      Math.sin(c.lat * RAD) * Math.cos(lat * RAD) * Math.cos(dLng),
    visible: cosC > 0,
  };
}

/** Orthographic point at height `k` (1 is the surface), screen offset and facing, as the mock's `proj`. */
const lift = (lat: number, lng: number, c: Point, k: number) => {
  const p = project(lat, lng, c);
  const cosC =
    Math.sin(c.lat * RAD) * Math.sin(lat * RAD) +
    Math.cos(c.lat * RAD) * Math.cos(lat * RAD) * Math.cos((lng - c.lng) * RAD);
  return { x: p.x * k, y: p.y * k, v: cosC };
};

/** The reference mock's globe: a pale sphere with a rim, a lattice of dots, airports, the route arc and its plane. */
function draw(ctx: CanvasRenderingContext2D, view: View): void {
  const { centre, target, from } = view;
  const at = (x: number, y: number): [number, number] => [SIZE / 2 + R * x, SIZE / 2 - R * y];
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, R, 0, 2 * Math.PI);
  ctx.fillStyle = "#e4f9e9";
  ctx.fill();
  ctx.strokeStyle = "#2e9d7188";
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let lat = -75; lat <= 75; lat += 9) {
    const step = 9 / Math.max(0.25, Math.cos(lat * RAD));
    for (let lng = 0; lng < 360; lng += step) {
      const q = lift(lat, lng - 180, centre, 1);
      if (q.v > 0) {
        const [x, y] = at(q.x, q.y);
        ctx.fillStyle = `rgba(38,104,75,${String(0.12 + q.v * 0.42)})`;
        ctx.fillRect(x - DOT / 2, y - DOT / 2, DOT, DOT);
      }
    }
  }
  ctx.fillStyle = "#245b41";
  for (const a of AIRPORT_DOTS) {
    const q = lift(a.lat, a.lng, centre, 1);
    if (q.v > 0) {
      const [x, y] = at(q.x, q.y);
      ctx.beginPath();
      ctx.arc(x, y, 1.6 * (SIZE / 118), 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  if (!target || view.marker <= 0) return;
  if (from) {
    // Great-circle arc lifted off the surface by up to 28%, drawn once the globe has arrived.
    const vec = (p: Point): [number, number, number] => [
      Math.cos(p.lat * RAD) * Math.cos(p.lng * RAD),
      Math.cos(p.lat * RAD) * Math.sin(p.lng * RAD),
      Math.sin(p.lat * RAD),
    ];
    const [a, b] = [vec(from), vec(target)];
    const w = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) || 1e-6;
    const pts = Array.from({ length: 65 }, (_, i) => {
      const t = i / 64;
      const [s1, s2] = [Math.sin((1 - t) * w) / Math.sin(w), Math.sin(t * w) / Math.sin(w)];
      const v = [0, 1, 2].map((j) => s1 * (a[j] ?? 0) + s2 * (b[j] ?? 0));
      const lat = Math.asin(Math.max(-1, Math.min(1, v[2] ?? 0))) / RAD;
      const lng = Math.atan2(v[1] ?? 0, v[0] ?? 0) / RAD;
      return lift(lat, lng, centre, 1 + 0.28 * Math.sin(Math.PI * t));
    });
    const n = Math.floor(view.marker * 64);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2e9d71";
    for (let i = 1; i <= n; i++) {
      const [p, q] = [pts[i - 1], pts[i]];
      if (p && q && p.v > 0 && q.v > 0) {
        ctx.globalAlpha = 0.35 + (0.65 * i) / 64;
        ctx.beginPath();
        ctx.moveTo(...at(p.x, p.y));
        ctx.lineTo(...at(q.x, q.y));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // The plane rests mid-route (the mock's reduced-motion position).
    const [p, q] = [pts[32], pts[33]];
    if (typeof Path2D !== "undefined" && view.marker >= 1 && p && q && p.v > 0 && q.v > 0) {
      const [px, py] = at(p.x, p.y);
      const [qx, qy] = at(q.x, q.y);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(qy - py, qx - px) + Math.PI / 2);
      ctx.fillStyle = "#143f2a";
      ctx.scale(0.5 * (SIZE / 118), 0.5 * (SIZE / 118));
      ctx.translate(-12, -12);
      ctx.fill(new Path2D(PLANE_PATH));
      ctx.restore();
    }
  }
  for (const end of from ? [from, target] : [target]) {
    const q = lift(end.lat, end.lng, centre, 1);
    if (q.v <= 0) continue;
    const [x, y] = at(q.x, q.y);
    ctx.fillStyle = "#143f2a";
    ctx.beginPath();
    ctx.arc(x, y, 2.6 * (SIZE / 118) * view.marker, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/**
 * A small globe, as in the reference mock, that turns to a catalogue airport and drops a marker there.
 * Decoration and feedback only: not focusable, no tap target. Reduced motion jumps instead of
 * turning. `code` unknown to the catalogue leaves it where it is. `size` is the CSS size; the
 * canvas keeps 200 px of its own, so a larger size is scaled, not redrawn. `from` adds the route arc.
 */
export function Globe({
  code,
  from,
  size = SIZE,
}: {
  code: string | undefined;
  from?: string | undefined;
  size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const origin = from ? airportCoordinates(from) : undefined;
  const view = useRef<View>({ centre: HOME, marker: 0, target: undefined, from: origin });
  view.current.from = origin;
  const target = code ? airportCoordinates(code) : undefined;
  const lat = target?.lat;
  const lng = target?.lng;

  const paint = () => {
    const el = canvas.current;
    if (!el) return;
    const { centre } = view.current;
    el.dataset.centre = `${centre.lat.toFixed(1)},${centre.lng.toFixed(1)}`;
    const ctx = el.getContext("2d");
    if (ctx) draw(ctx, view.current);
  };

  useEffect(() => {
    const v = view.current;
    if (lat === undefined || lng === undefined) {
      paint();
      return;
    }
    const to = { lat, lng };
    v.target = to;
    if (prefersReducedMotion()) {
      v.centre = to;
      v.marker = 1;
      paint();
      return;
    }
    const gap = () =>
      Math.abs(((to.lng - v.centre.lng + 540) % 360) - 180) + Math.abs(to.lat - v.centre.lat);
    const start = Math.max(gap(), 1);
    v.marker = 0;
    let frame = 0;
    const turn = () => {
      const dLng = ((to.lng - v.centre.lng + 540) % 360) - 180;
      v.centre = {
        lat: v.centre.lat + (to.lat - v.centre.lat) * 0.12,
        lng: v.centre.lng + dLng * 0.12,
      };
      const left = gap();
      v.marker = left < 0.3 ? 1 : 1 - Math.min(1, left / start);
      if (left < 0.3) v.centre = to;
      paint();
      if (left >= 0.3) frame = requestAnimationFrame(turn);
    };
    frame = requestAnimationFrame(turn);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [lat, lng]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={
        code && target ? t("flight.globeLabel", { place: airportName(code) }) : t("flight.globe")
      }
      width={SIZE * 2}
      height={SIZE * 2}
      style={{ width: size, height: size }}
      className="shrink-0"
    />
  );
}
