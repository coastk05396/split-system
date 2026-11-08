import { airportCoordinates } from "@split/shared";
import { useEffect, useRef } from "react";
import { t } from "../i18n/messages.js";
import { prefersReducedMotion } from "../shell/motion.js";
import { airportName } from "./AirportPicker.js";

const SIZE = 100; // CSS px; the canvas has twice the pixels
const R = 46;
const RAD = Math.PI / 180;
// Where the globe faces before it has been told anywhere: Taiwan.
const HOME = { lat: 23.7, lng: 121 };

interface Point {
  lat: number;
  lng: number;
}
type Land = readonly (readonly number[])[];

interface View {
  centre: Point;
  /** The marker's size, 0 to 1: it grows as the globe arrives. */
  marker: number;
  target: Point | undefined;
  land: Land | undefined;
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

function draw(ctx: CanvasRenderingContext2D, view: View): void {
  const { centre, land, target } = view;
  const at = (x: number, y: number): [number, number] => [SIZE / 2 + R * x, SIZE / 2 - R * y];
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, R, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  if (land) {
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    for (const ring of land) {
      for (let i = 0; i < ring.length; i += 2) {
        const p = project((ring[i + 1] ?? 0) / 2, (ring[i] ?? 0) / 2, centre);
        // shortcut: a far-side point is pushed out to the rim, which fills a coast that crosses the
        // horizon well enough at 100 px; upgrade to true horizon clipping if the globe grows.
        const len = Math.hypot(p.x, p.y) || 1;
        const [x, y] = p.visible ? at(p.x, p.y) : at(p.x / len, p.y / len);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = "#8cc3a8";
    ctx.fill("evenodd");
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, R, 0, 2 * Math.PI);
  ctx.strokeStyle = "#2e9d71";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (target && view.marker > 0) {
    const p = project(target.lat, target.lng, centre);
    if (p.visible) {
      const [x, y] = at(p.x, p.y);
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * view.marker, 0, 2 * Math.PI);
      ctx.fillStyle = "#143f2a";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

/**
 * A small globe of real land outlines that turns to a catalogue airport and drops a marker there.
 * Decoration and feedback only: not focusable, no tap target. Reduced motion jumps instead of
 * turning. `code` unknown to the catalogue leaves it where it is.
 */
export function Globe({ code }: { code: string | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ centre: HOME, marker: 0, target: undefined, land: undefined });
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

  // The land is a separate chunk: the globe shows its sphere first and the coasts when it arrives.
  useEffect(() => {
    let live = true;
    void import("./land.js").then((m) => {
      if (!live) return;
      view.current.land = m.LAND;
      paint();
    });
    return () => {
      live = false;
    };
  }, []);

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
      style={{ width: SIZE, height: SIZE }}
      className="shrink-0"
    />
  );
}
