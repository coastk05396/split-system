import { airportCoordinates, routeEstimate } from "@split/shared";
import { useEffect, useRef } from "react";
import { getLocale, t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";

const SIZE = 56;
const RAD = Math.PI / 180;

interface Point {
  lat: number;
  lng: number;
}

/** Screen position of a point on a globe centred on `centre`; `visible` is false on the far side. */
function project(p: Point, centre: Point): { x: number; y: number; visible: boolean } {
  const lng = (p.lng - centre.lng) * RAD;
  const cosC =
    Math.sin(centre.lat * RAD) * Math.sin(p.lat * RAD) +
    Math.cos(centre.lat * RAD) * Math.cos(p.lat * RAD) * Math.cos(lng);
  const r = SIZE * 0.4;
  return {
    x: SIZE / 2 + r * Math.cos(p.lat * RAD) * Math.sin(lng),
    y:
      SIZE / 2 -
      r *
        (Math.cos(centre.lat * RAD) * Math.sin(p.lat * RAD) -
          Math.sin(centre.lat * RAD) * Math.cos(p.lat * RAD) * Math.cos(lng)),
    visible: cosC > 0,
  };
}

function draw(ctx: CanvasRenderingContext2D, centre: Point, from: Point, to: Point): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE * 0.4, 0, 2 * Math.PI);
  ctx.fillStyle = "#e4f9e9";
  ctx.fill();
  ctx.strokeStyle = "#2e9d71";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#26684b55";
  for (let lat = -60; lat <= 60; lat += 20)
    for (let lng = -180; lng < 180; lng += 20 / Math.max(0.3, Math.cos(lat * RAD))) {
      const q = project({ lat, lng }, centre);
      if (q.visible) ctx.fillRect(q.x - 0.6, q.y - 0.6, 1.2, 1.2);
    }
  ctx.strokeStyle = "#2e9d71";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  // A straight chord on screen is enough at this size; the globe is a flourish, not a map.
  const a = project(from, centre);
  const b = project(to, centre);
  if (a.visible && b.visible) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.fillStyle = "#143f2a";
  for (const q of [a, b]) {
    if (!q.visible) continue;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 2.2, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/** Midpoint of the great-circle arc, the place the globe turns to face. */
function midpoint(a: Point, b: Point): Point {
  const v = (p: Point) => [
    Math.cos(p.lat * RAD) * Math.cos(p.lng * RAD),
    Math.cos(p.lat * RAD) * Math.sin(p.lng * RAD),
    Math.sin(p.lat * RAD),
  ];
  const [ax = 0, ay = 0, az = 0] = v(a);
  const [bx = 0, by = 0, bz = 0] = v(b);
  const [x, y, z] = [ax + bx, ay + by, az + bz];
  return {
    lat: Math.atan2(z, Math.hypot(x, y)) / RAD,
    lng: Math.atan2(y, x) / RAD,
  };
}

/**
 * A small decorative globe that turns to face the route, with its distance and rough flight time.
 * Renders nothing unless both airports have known coordinates. Reduced motion shows it already
 * turned; the canvas is described by one label and the figures are real text.
 */
export function RouteGlobe({ origin, destination }: { origin: string; destination: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const centre = useRef<Point | null>(null);
  const from = airportCoordinates(origin);
  const to = airportCoordinates(destination);
  const estimate = routeEstimate(origin, destination);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !from || !to) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0); // the canvas is drawn at twice its CSS size
    const target = midpoint(from, to);
    if (prefersReducedMotion() || !centre.current) {
      centre.current = target;
      draw(ctx, target, from, to);
      return;
    }
    let frame = 0;
    const turn = () => {
      const c = centre.current ?? target;
      const dLng = ((target.lng - c.lng + 540) % 360) - 180;
      const next = {
        lat: c.lat + (target.lat - c.lat) * 0.12,
        lng: c.lng + dLng * 0.12,
      };
      centre.current = next;
      draw(ctx, next, from, to);
      if (Math.abs(dLng) + Math.abs(target.lat - next.lat) > 0.3)
        frame = requestAnimationFrame(turn);
    };
    frame = requestAnimationFrame(turn);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [from, to]);

  if (!from || !to || !estimate) return null;
  const hours = Math.floor(estimate.minutes / 60);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <p className="text-right text-xs font-bold tabular-nums text-ink-muted">
        {t("flight.globeLeg", {
          km: estimate.km.toLocaleString(getLocale()),
          hours,
          minutes: estimate.minutes - hours * 60,
        })}
      </p>
      <canvas
        ref={canvas}
        role="img"
        aria-label={t("flight.globeLabel", { route: `${origin} → ${destination}` })}
        width={SIZE * 2}
        height={SIZE * 2}
        style={{ width: SIZE, height: SIZE }}
      />
    </div>
  );
}
