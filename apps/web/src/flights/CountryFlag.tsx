import { type ReactNode, useId } from "react";

const STAR_5 =
  "0,-4.5 1.1,-1.5 4.3,-1.5 1.7,0.6 2.7,3.7 0,1.8 -2.7,3.7 -1.7,0.6 -4.3,-1.5 -1.1,-1.5";

/** Seven-pointed star (Jordan), unit-ish size like STAR_5: outer radius 4.5, inner 2. */
const STAR_7 = Array.from({ length: 14 }, (_, i) => {
  const r = i % 2 === 0 ? 4.5 : 2;
  const a = (i * Math.PI) / 7;
  return `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`;
}).join(" ");

function hBands(bands: readonly { h: number; fill: string }[]): ReactNode {
  let y = 0;
  return bands.map((band, index) => {
    const el = <rect key={index} x={0} y={y} width={32} height={band.h} fill={band.fill} />;
    y += band.h;
    return el;
  });
}

function vBands(colors: readonly [string, string, string]): ReactNode {
  return (
    <>
      <rect x={0} y={0} width={10.7} height={32} fill={colors[0]} />
      <rect x={10.6} y={0} width={10.8} height={32} fill={colors[1]} />
      <rect x={21.3} y={0} width={10.7} height={32} fill={colors[2]} />
    </>
  );
}

/** Scandinavian off-centre cross: a field with a `cross` colour band 9 units from the hoist. */
function nordicCross(field: string, cross: string): ReactNode {
  return (
    <>
      <rect width={32} height={32} fill={field} />
      <rect x={9} width={5} height={32} fill={cross} />
      <rect y={13.5} width={32} height={5} fill={cross} />
    </>
  );
}

function unionJackShapes(w: number, h: number): ReactNode {
  const cx = w / 2;
  const cy = h / 2;
  return (
    <>
      <rect x={0} y={0} width={w} height={h} fill="#012169" />
      <path d={`M0,0 L${w},${h} M${w},0 L0,${h}`} stroke="#FFFFFF" strokeWidth={w * 0.14} />
      <path d={`M0,0 L${w},${h} M${w},0 L0,${h}`} stroke="#C8102E" strokeWidth={w * 0.07} />
      <path d={`M${cx},0 V${h} M0,${cy} H${w}`} stroke="#FFFFFF" strokeWidth={w * 0.24} />
      <path d={`M${cx},0 V${h} M0,${cy} H${w}`} stroke="#C8102E" strokeWidth={w * 0.14} />
    </>
  );
}

function renderFlagBody(code: string): ReactNode {
  switch (code) {
    case "JP":
      return (
        <>
          <rect width={32} height={32} fill="#FFFFFF" />
          <circle cx={16} cy={16} r={7.2} fill="#BC002D" />
        </>
      );
    case "KR":
      return (
        <>
          <rect width={32} height={32} fill="#FFFFFF" />
          <g transform="translate(16 16) rotate(-35)">
            <path d="M-6,0 A6,6 0 0,1 6,0 A3,3 0 0,1 0,0 A3,3 0 0,0 -6,0 Z" fill="#CD2E3A" />
            <path d="M6,0 A6,6 0 0,1 -6,0 A3,3 0 0,1 0,0 A3,3 0 0,0 6,0 Z" fill="#0047A0" />
          </g>
          <g stroke="#111827" strokeWidth={1.4} strokeLinecap="butt">
            <path d="M5,7 L8.5,4.2 M6.2,8.4 L9.7,5.6" />
            <path d="M23.5,4.2 L27,7 M22.3,5.6 L25.8,8.4" />
            <path d="M5,25 L8.5,27.8 M6.2,23.6 L9.7,26.4" />
            <path d="M23.5,27.8 L27,25 M22.3,26.4 L25.8,23.6" />
          </g>
        </>
      );
    case "TH":
      return hBands([
        { h: 5.3, fill: "#A51931" },
        { h: 5.3, fill: "#FFFFFF" },
        { h: 10.8, fill: "#2D2A4A" },
        { h: 5.3, fill: "#FFFFFF" },
        { h: 5.3, fill: "#A51931" },
      ]);
    case "ID":
      return hBands([
        { h: 16, fill: "#CE1126" },
        { h: 16, fill: "#FFFFFF" },
      ]);
    case "DE":
      return hBands([
        { h: 10.7, fill: "#111827" },
        { h: 10.6, fill: "#DD0000" },
        { h: 10.7, fill: "#FFCE00" },
      ]);
    case "NL":
      return hBands([
        { h: 10.7, fill: "#AE1C28" },
        { h: 10.6, fill: "#FFFFFF" },
        { h: 10.7, fill: "#21468B" },
      ]);
    case "FR":
      return vBands(["#0055A4", "#FFFFFF", "#EF4135"]);
    case "IT":
      return vBands(["#009246", "#FFFFFF", "#CE2B37"]);
    case "ES":
      return hBands([
        { h: 8, fill: "#AA151B" },
        { h: 16, fill: "#F1BF00" },
        { h: 8, fill: "#AA151B" },
      ]);
    case "CZ":
      return (
        <>
          <rect width={32} height={16} fill="#FFFFFF" />
          <rect y={16} width={32} height={16} fill="#D7141A" />
          <path d="M0,0 L16,16 L0,32 Z" fill="#11457E" />
        </>
      );
    case "CH":
      return (
        <>
          <rect width={32} height={32} fill="#DA291C" />
          <rect x={13} y={7} width={6} height={18} fill="#FFFFFF" />
          <rect x={7} y={13} width={18} height={6} fill="#FFFFFF" />
        </>
      );
    case "IS":
      return (
        <>
          <rect width={32} height={32} fill="#02529C" />
          <rect x={8} width={6} height={32} fill="#FFFFFF" />
          <rect y={13} width={32} height={6} fill="#FFFFFF" />
          <rect x={9.5} width={3} height={32} fill="#DC1E35" />
          <rect y={14.5} width={32} height={3} fill="#DC1E35" />
        </>
      );
    case "AT":
      return hBands([
        { h: 10.7, fill: "#ED2939" },
        { h: 10.6, fill: "#FFFFFF" },
        { h: 10.7, fill: "#ED2939" },
      ]);
    case "HU":
      return hBands([
        { h: 10.7, fill: "#CD2A3E" },
        { h: 10.6, fill: "#FFFFFF" },
        { h: 10.7, fill: "#436F4D" },
      ]);
    case "PL":
      return hBands([
        { h: 16, fill: "#FFFFFF" },
        { h: 16, fill: "#DC143C" },
      ]);
    case "BE":
      return vBands(["#000000", "#FAE042", "#ED2939"]);
    case "IE":
      return vBands(["#169B62", "#FFFFFF", "#FF883E"]);
    case "DK":
      return nordicCross("#C8102E", "#FFFFFF");
    case "SE":
      return nordicCross("#006AA7", "#FECC00");
    case "FI":
      return nordicCross("#FFFFFF", "#003580");
    case "NO":
      return (
        <>
          {nordicCross("#BA0C2F", "#FFFFFF")}
          <rect x={10} width={3} height={32} fill="#00205B" />
          <rect y={14.5} width={32} height={3} fill="#00205B" />
        </>
      );
    case "PT":
      return (
        <>
          <rect width={32} height={32} fill="#FF0000" />
          <rect width={12.8} height={32} fill="#006600" />
          <circle cx={12.8} cy={16} r={5} fill="#FFE000" />
          <circle cx={12.8} cy={16} r={3} fill="#FF0000" />
          <rect x={11.3} y={14.5} width={3} height={3} fill="#FFFFFF" />
        </>
      );
    case "GR":
      return (
        <>
          {Array.from({ length: 9 }, (_, i) => (
            <rect
              key={i}
              y={(i * 32) / 9}
              width={32}
              height={32 / 9 + 0.05}
              fill={i % 2 === 0 ? "#0D5EAF" : "#FFFFFF"}
            />
          ))}
          <rect width={17.8} height={17.8} fill="#0D5EAF" />
          <rect x={7.4} width={3} height={17.8} fill="#FFFFFF" />
          <rect y={7.4} width={17.8} height={3} fill="#FFFFFF" />
        </>
      );
    case "QA":
      return (
        <>
          <rect width={32} height={32} fill="#8A1538" />
          <polygon
            points={`0,0 ${Array.from({ length: 9 }, (_, i) => `9,${(i * 32) / 9} 13.5,${(i * 32) / 9 + 16 / 9}`).join(" ")} 9,32 0,32`}
            fill="#FFFFFF"
          />
        </>
      );
    case "EG":
      return (
        <>
          {hBands([
            { h: 10.7, fill: "#CE1126" },
            { h: 10.6, fill: "#FFFFFF" },
            { h: 10.7, fill: "#000000" },
          ])}
          <circle cx={16} cy={16} r={3} fill="#C09300" />
        </>
      );
    case "JO":
      return (
        <>
          {hBands([
            { h: 10.7, fill: "#000000" },
            { h: 10.6, fill: "#FFFFFF" },
            { h: 10.7, fill: "#007A3D" },
          ])}
          <path d="M0,0 L18,16 L0,32 Z" fill="#CE1126" />
          <polygon points={STAR_7} transform="translate(5.5 16) scale(0.9)" fill="#FFFFFF" />
        </>
      );
    case "CA":
      return (
        <>
          <rect x={0} y={0} width={8.5} height={32} fill="#D80621" />
          <rect x={8.5} y={0} width={15} height={32} fill="#FFFFFF" />
          <rect x={23.5} y={0} width={8.5} height={32} fill="#D80621" />
          <path
            d="M16,8.5 L17.4,12.5 L20.2,11.6 L18.8,14.8 L21.4,16 L19.2,17.2 L19.8,19 L16.6,18.6 L16.6,23.2 L15.4,23.2 L15.4,18.6 L12.2,19 L12.8,17.2 L10.6,16 L13.2,14.8 L11.8,11.6 L14.6,12.5 Z"
            fill="#D80621"
          />
        </>
      );
    case "VN":
      return (
        <>
          <rect width={32} height={32} fill="#DA251D" />
          <polygon points={STAR_5} transform="translate(16 16) scale(1.8)" fill="#FFCD00" />
        </>
      );
    case "CN":
      return (
        <>
          <rect width={32} height={32} fill="#DE2910" />
          <polygon points={STAR_5} transform="translate(9 10.5) scale(1.05)" fill="#FFDE00" />
          <circle cx={15} cy={6.5} r={1.05} fill="#FFDE00" />
          <circle cx={17} cy={9.5} r={1.05} fill="#FFDE00" />
          <circle cx={16.5} cy={13} r={1.05} fill="#FFDE00" />
          <circle cx={14} cy={15.2} r={1.05} fill="#FFDE00" />
        </>
      );
    case "HK":
      return (
        <>
          <rect width={32} height={32} fill="#DE2910" />
          {[0, 72, 144, 216, 288].map((deg) => (
            <ellipse
              key={deg}
              cx={16}
              cy={11}
              rx={2.3}
              ry={4.5}
              fill="#FFFFFF"
              transform={`rotate(${deg} 16 16)`}
            />
          ))}
          <circle cx={16} cy={16} r={1.6} fill="#DE2910" />
        </>
      );
    case "MO":
      return (
        <>
          <rect width={32} height={32} fill="#00785E" />
          <ellipse cx={16} cy={17.5} rx={5.8} ry={3.8} fill="#FFFFFF" />
          <path d="M16,11.5 C18.5,14 18.5,17 16,19.5 C13.5,17 13.5,14 16,11.5 Z" fill="#FFFFFF" />
          <circle cx={11} cy={10} r={1} fill="#FFDE00" />
          <circle cx={13.5} cy={8.5} r={1} fill="#FFDE00" />
          <circle cx={16} cy={7.8} r={1.2} fill="#FFDE00" />
          <circle cx={18.5} cy={8.5} r={1} fill="#FFDE00" />
          <circle cx={21} cy={10} r={1} fill="#FFDE00" />
        </>
      );
    case "SG":
      return (
        <>
          <rect x={0} y={0} width={32} height={16} fill="#EF3340" />
          <rect x={0} y={16} width={32} height={16} fill="#FFFFFF" />
          <circle cx={10} cy={8.5} r={4.5} fill="#FFFFFF" />
          <circle cx={11.5} cy={8.5} r={3.8} fill="#EF3340" />
          <circle cx={13} cy={6.2} r={0.9} fill="#FFFFFF" />
          <circle cx={15} cy={7.6} r={0.9} fill="#FFFFFF" />
          <circle cx={14.3} cy={10} r={0.9} fill="#FFFFFF" />
          <circle cx={11.7} cy={10} r={0.9} fill="#FFFFFF" />
          <circle cx={11.2} cy={7.6} r={0.9} fill="#FFFFFF" />
        </>
      );
    case "MY":
      return (
        <>
          <rect width={32} height={32} fill="#FFFFFF" />
          {[0, 4.6, 9.2, 13.8, 18.4, 23, 27.6].map((y, idx) => (
            <rect key={idx} x={0} y={y} width={32} height={2.3} fill="#CC0001" />
          ))}
          <rect x={0} y={0} width={17} height={16.5} fill="#010066" />
          <circle cx={7.5} cy={8.2} r={4.5} fill="#FFCC00" />
          <circle cx={9} cy={8.2} r={3.6} fill="#010066" />
          <polygon points={STAR_5} transform="translate(12.2 8.2) scale(0.75)" fill="#FFCC00" />
        </>
      );
    case "PH":
      return (
        <>
          <rect x={0} y={0} width={32} height={16} fill="#0038A8" />
          <rect x={0} y={16} width={32} height={16} fill="#CE1126" />
          <polygon points="0,0 16.5,16 0,32" fill="#FFFFFF" />
          <circle cx={6.2} cy={16} r={3.2} fill="#FCD116" />
          <circle cx={3} cy={7} r={1.1} fill="#FCD116" />
          <circle cx={3} cy={25} r={1.1} fill="#FCD116" />
          <circle cx={12.5} cy={16} r={1.1} fill="#FCD116" />
        </>
      );
    case "TR":
      return (
        <>
          <rect width={32} height={32} fill="#E30A17" />
          <circle cx={13.5} cy={16} r={6.2} fill="#FFFFFF" />
          <circle cx={15.2} cy={16} r={5} fill="#E30A17" />
          <polygon
            points={STAR_5}
            transform="translate(21.5 16) rotate(-18) scale(0.85)"
            fill="#FFFFFF"
          />
        </>
      );
    case "AE":
      return (
        <>
          {hBands([
            { h: 10.7, fill: "#00732F" },
            { h: 10.6, fill: "#FFFFFF" },
            { h: 10.7, fill: "#111827" },
          ])}
          <rect x={0} y={0} width={9.5} height={32} fill="#FF0000" />
        </>
      );
    case "US":
      return (
        <>
          <rect width={32} height={32} fill="#FFFFFF" />
          {[0, 5, 10, 15, 20, 25, 30].map((y, idx) => (
            <rect key={idx} x={0} y={y} width={32} height={2.5} fill="#B22234" />
          ))}
          <rect x={0} y={0} width={16.5} height={17} fill="#3C3B6E" />
          {[4, 8.2, 12.5].map((x) =>
            [4, 8.5, 13].map((y) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={0.95} fill="#FFFFFF" />
            )),
          )}
        </>
      );
    case "MX":
      return (
        <>
          {vBands(["#006847", "#FFFFFF", "#CE1126"])}
          <circle cx={16} cy={16} r={3.6} fill="#8C6A3F" />
          <circle cx={16} cy={16} r={2.2} fill="#006847" />
        </>
      );
    case "GB":
      return unionJackShapes(32, 32);
    case "AU":
      return (
        <>
          <rect width={32} height={32} fill="#012169" />
          {unionJackShapes(16, 16)}
          <polygon points={STAR_5} transform="translate(8 23.5) scale(0.9)" fill="#FFFFFF" />
          <circle cx={23.5} cy={8} r={1.3} fill="#FFFFFF" />
          <circle cx={20} cy={14} r={1.2} fill="#FFFFFF" />
          <circle cx={26.5} cy={13.5} r={1.2} fill="#FFFFFF" />
          <circle cx={23.5} cy={22.5} r={1.4} fill="#FFFFFF" />
          <circle cx={25.8} cy={17.8} r={0.9} fill="#FFFFFF" />
        </>
      );
    case "NZ":
      return (
        <>
          <rect width={32} height={32} fill="#012169" />
          {unionJackShapes(16, 16)}
          <circle cx={23.5} cy={8.5} r={1.8} fill="#FFFFFF" />
          <circle cx={23.5} cy={8.5} r={1.1} fill="#C8102E" />
          <circle cx={19.5} cy={14.5} r={1.7} fill="#FFFFFF" />
          <circle cx={19.5} cy={14.5} r={1} fill="#C8102E" />
          <circle cx={27} cy={13.8} r={1.7} fill="#FFFFFF" />
          <circle cx={27} cy={13.8} r={1} fill="#C8102E" />
          <circle cx={23.5} cy={22.5} r={2} fill="#FFFFFF" />
          <circle cx={23.5} cy={22.5} r={1.2} fill="#C8102E" />
        </>
      );
    case "MT":
      return (
        <>
          <rect width={16} height={32} fill="#FFFFFF" />
          <rect x={16} width={16} height={32} fill="#CF142B" />
          <path d="M8,6 V12 M5,9 H11" stroke="#9CA3AF" strokeWidth={1.8} />
        </>
      );
    case "GU":
      return (
        <>
          <rect width={32} height={32} fill="#C62139" />
          <rect x={2.5} y={2.5} width={27} height={27} fill="#00297B" />
          <ellipse cx={16} cy={16} rx={5.5} ry={8} fill="#C62139" />
          <ellipse cx={16} cy={16} rx={4.5} ry={7} fill="#7EC8E3" />
          <path d="M11.5,19 H20.5 V22 Q16,24.5 11.5,22 Z" fill="#E9D8A6" />
        </>
      );
    case "PW":
      return (
        <>
          <rect width={32} height={32} fill="#4AADD6" />
          <circle cx={14} cy={16} r={7.5} fill="#FFDE00" />
        </>
      );
    case "MP":
      return (
        <>
          <rect width={32} height={32} fill="#0071BC" />
          <circle cx={16} cy={16} r={9} fill="none" stroke="#4D8B3F" strokeWidth={1.6} />
          <rect x={13.5} y={10} width={5} height={13} rx={1.5} fill="#9CA3AF" />
          <polygon points={STAR_5} transform="translate(16 16) scale(1.1)" fill="#FFFFFF" />
        </>
      );
    default:
      return (
        <>
          <rect width={32} height={32} fill="#E0F2FE" />
          <circle cx={16} cy={16} r={9} fill="#0284C7" />
        </>
      );
  }
}

/** Crisp circular SVG country emblem so flag icons never fall back to OS country letters like `VN`/`MO`. */
export function CountryFlag({
  countryCode,
  className = "size-10",
}: {
  countryCode: string;
  className?: string;
}) {
  const clipId = useId();
  const code = countryCode.toUpperCase();
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-[1.5px] ring-fl-hair ${className}`}
    >
      <svg viewBox="0 0 32 32" aria-hidden="true" data-country={code} className="size-full">
        <defs>
          <clipPath id={clipId}>
            <circle cx={16} cy={16} r={16} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>{renderFlagBody(code)}</g>
      </svg>
    </span>
  );
}
