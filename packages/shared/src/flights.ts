import { z } from "zod";
import { localDateSchema } from "./schemas.js";

export const FLIGHT_ORIGINS = ["TPE", "TSA", "KHH", "RMQ", "TNN"] as const;
export type FlightOrigin = (typeof FLIGHT_ORIGINS)[number];

export const FLIGHT_REGIONS = ["jp", "kr", "sea", "hkmo", "longhaul"] as const;
export type FlightRegion = (typeof FLIGHT_REGIONS)[number];

export const FLIGHT_TRIP_TYPES = ["rt", "ow"] as const;
export type FlightTripType = (typeof FLIGHT_TRIP_TYPES)[number];

export const DEAL_TAGS = ["steal", "below_market", "normal"] as const;
export type DealTag = (typeof DEAL_TAGS)[number];

export const FLIGHT_SORT_OPTIONS = ["price", "discount"] as const;
export type FlightSortBy = (typeof FLIGHT_SORT_OPTIONS)[number];
export type FlightSortDirection = "asc" | "desc";
export type FlightStopsFilter = "all" | "direct" | "transfer";

/** Multiplier converting typical roundtrip baseline fares into one-way deal baselines. */
export const ONE_WAY_BASELINE_FACTOR = 0.58;

export const flightOriginSchema = z.enum(FLIGHT_ORIGINS);
export const flightRegionSchema = z.enum(FLIGHT_REGIONS);
export const flightTripTypeSchema = z.enum(FLIGHT_TRIP_TYPES);
export const dealTagSchema = z.enum(DEAL_TAGS);

export interface OriginMeta {
  code: FlightOrigin;
  cityCode: string;
  zhTW: string;
  en: string;
  shortZhTW: string;
  shortEn: string;
}

export const ORIGIN_META: Readonly<Record<FlightOrigin, OriginMeta>> = {
  TPE: {
    code: "TPE",
    cityCode: "tpe",
    zhTW: "台北桃園",
    en: "Taipei Taoyuan",
    shortZhTW: "桃園",
    shortEn: "Taoyuan",
  },
  TSA: {
    code: "TSA",
    cityCode: "tpe",
    zhTW: "台北松山",
    en: "Taipei Songshan",
    shortZhTW: "松山",
    shortEn: "Songshan",
  },
  KHH: {
    code: "KHH",
    cityCode: "khh",
    zhTW: "高雄小港",
    en: "Kaohsiung",
    shortZhTW: "高雄",
    shortEn: "Kaohsiung",
  },
  RMQ: {
    code: "RMQ",
    cityCode: "rmq",
    zhTW: "台中清泉崗",
    en: "Taichung",
    shortZhTW: "台中",
    shortEn: "Taichung",
  },
  TNN: {
    code: "TNN",
    cityCode: "tnn",
    zhTW: "台南機場",
    en: "Tainan",
    shortZhTW: "台南",
    shortEn: "Tainan",
  },
};

export interface DestinationMeta {
  airport: string;
  cityCode: string;
  countryCode: string;
  flag: string;
  zhTW: string;
  en: string;
  countryZhTW: string;
  countryEn: string;
  region: FlightRegion;
  /** Typical roundtrip baseline in TWD; only scores the curated fallback board (live fares use the day's median). */
  baselineTwd: number;
}

export const DESTINATION_CATALOG: readonly DestinationMeta[] = [
  // Japan
  {
    airport: "NRT",
    cityCode: "tyo",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "東京成田",
    en: "Tokyo Narita",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11800,
  },
  {
    airport: "HND",
    cityCode: "tyo",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "東京羽田",
    en: "Tokyo Haneda",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 13200,
  },
  {
    airport: "KIX",
    cityCode: "osa",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "大阪關西",
    en: "Osaka Kansai",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11500,
  },
  {
    airport: "FUK",
    cityCode: "fuk",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "福岡",
    en: "Fukuoka",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 10800,
  },
  {
    airport: "OKA",
    cityCode: "oka",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "沖繩那霸",
    en: "Okinawa",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 8200,
  },
  {
    airport: "CTS",
    cityCode: "spk",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "札幌新千歲",
    en: "Sapporo",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 15800,
  },
  {
    airport: "NGO",
    cityCode: "ngo",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "名古屋",
    en: "Nagoya",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11200,
  },
  {
    airport: "SDJ",
    cityCode: "sdj",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "仙台",
    en: "Sendai",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 13500,
  },
  {
    airport: "KMJ",
    cityCode: "kmj",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "熊本",
    en: "Kumamoto",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11500,
  },
  {
    airport: "KOJ",
    cityCode: "koj",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "鹿兒島",
    en: "Kagoshima",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11800,
  },
  // South Korea
  {
    airport: "ICN",
    cityCode: "sel",
    countryCode: "KR",
    flag: "🇰🇷",
    zhTW: "首爾仁川",
    en: "Seoul Incheon",
    countryZhTW: "韓國",
    countryEn: "South Korea",
    region: "kr",
    baselineTwd: 9200,
  },
  {
    airport: "GMP",
    cityCode: "sel",
    countryCode: "KR",
    flag: "🇰🇷",
    zhTW: "首爾金浦",
    en: "Seoul Gimpo",
    countryZhTW: "韓國",
    countryEn: "South Korea",
    region: "kr",
    baselineTwd: 9800,
  },
  {
    airport: "PUS",
    cityCode: "pus",
    countryCode: "KR",
    flag: "🇰🇷",
    zhTW: "釜山",
    en: "Busan",
    countryZhTW: "韓國",
    countryEn: "South Korea",
    region: "kr",
    baselineTwd: 8600,
  },
  {
    airport: "CJU",
    cityCode: "cju",
    countryCode: "KR",
    flag: "🇰🇷",
    zhTW: "濟州島",
    en: "Jeju",
    countryZhTW: "韓國",
    countryEn: "South Korea",
    region: "kr",
    baselineTwd: 8800,
  },
  {
    airport: "TAE",
    cityCode: "tae",
    countryCode: "KR",
    flag: "🇰🇷",
    zhTW: "大邱",
    en: "Daegu",
    countryZhTW: "韓國",
    countryEn: "South Korea",
    region: "kr",
    baselineTwd: 8400,
  },
  // Southeast Asia
  {
    airport: "BKK",
    cityCode: "bkk",
    countryCode: "TH",
    flag: "🇹🇭",
    zhTW: "曼谷蘇凡納布",
    en: "Bangkok BKK",
    countryZhTW: "泰國",
    countryEn: "Thailand",
    region: "sea",
    baselineTwd: 9600,
  },
  {
    airport: "DMK",
    cityCode: "bkk",
    countryCode: "TH",
    flag: "🇹🇭",
    zhTW: "曼谷廊曼",
    en: "Bangkok DMK",
    countryZhTW: "泰國",
    countryEn: "Thailand",
    region: "sea",
    baselineTwd: 8500,
  },
  {
    airport: "CNX",
    cityCode: "cnx",
    countryCode: "TH",
    flag: "🇹🇭",
    zhTW: "清邁",
    en: "Chiang Mai",
    countryZhTW: "泰國",
    countryEn: "Thailand",
    region: "sea",
    baselineTwd: 10200,
  },
  {
    airport: "SIN",
    cityCode: "sin",
    countryCode: "SG",
    flag: "🇸🇬",
    zhTW: "新加坡",
    en: "Singapore",
    countryZhTW: "新加坡",
    countryEn: "Singapore",
    region: "sea",
    baselineTwd: 11200,
  },
  {
    airport: "KUL",
    cityCode: "kul",
    countryCode: "MY",
    flag: "🇲🇾",
    zhTW: "吉隆坡",
    en: "Kuala Lumpur",
    countryZhTW: "馬來西亞",
    countryEn: "Malaysia",
    region: "sea",
    baselineTwd: 9500,
  },
  {
    airport: "DAD",
    cityCode: "dad",
    countryCode: "VN",
    flag: "🇻🇳",
    zhTW: "峴港",
    en: "Da Nang",
    countryZhTW: "越南",
    countryEn: "Vietnam",
    region: "sea",
    baselineTwd: 9200,
  },
  {
    airport: "SGN",
    cityCode: "sgn",
    countryCode: "VN",
    flag: "🇻🇳",
    zhTW: "胡志明市",
    en: "Ho Chi Minh City",
    countryZhTW: "越南",
    countryEn: "Vietnam",
    region: "sea",
    baselineTwd: 8600,
  },
  {
    airport: "HAN",
    cityCode: "han",
    countryCode: "VN",
    flag: "🇻🇳",
    zhTW: "河內",
    en: "Hanoi",
    countryZhTW: "越南",
    countryEn: "Vietnam",
    region: "sea",
    baselineTwd: 8800,
  },
  {
    airport: "MNL",
    cityCode: "mnl",
    countryCode: "PH",
    flag: "🇵🇭",
    zhTW: "馬尼拉",
    en: "Manila",
    countryZhTW: "菲律賓",
    countryEn: "Philippines",
    region: "sea",
    baselineTwd: 6200,
  },
  {
    airport: "DPS",
    cityCode: "dps",
    countryCode: "ID",
    flag: "🇮🇩",
    zhTW: "峇里島",
    en: "Bali",
    countryZhTW: "印尼",
    countryEn: "Indonesia",
    region: "sea",
    baselineTwd: 13800,
  },
  // HK / Macau / Mainland China
  {
    airport: "HKG",
    cityCode: "hkg",
    countryCode: "HK",
    flag: "🇭🇰",
    zhTW: "香港",
    en: "Hong Kong",
    countryZhTW: "香港",
    countryEn: "Hong Kong",
    region: "hkmo",
    baselineTwd: 6800,
  },
  {
    airport: "MFM",
    cityCode: "mfm",
    countryCode: "MO",
    flag: "🇲🇴",
    zhTW: "澳門",
    en: "Macau",
    countryZhTW: "澳門",
    countryEn: "Macau",
    region: "hkmo",
    baselineTwd: 6200,
  },
  {
    airport: "PVG",
    cityCode: "sha",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "上海浦東",
    en: "Shanghai Pudong",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 9800,
  },
  {
    airport: "SHA",
    cityCode: "sha",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "上海虹橋",
    en: "Shanghai Hongqiao",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 10500,
  },
  {
    airport: "PEK",
    cityCode: "bjs",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "北京首都",
    en: "Beijing",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 11800,
  },
  // Long-haul (Europe, North America, Middle East, Oceania)
  {
    airport: "LHR",
    cityCode: "lon",
    countryCode: "GB",
    flag: "🇬🇧",
    zhTW: "倫敦希斯洛",
    en: "London Heathrow",
    countryZhTW: "英國",
    countryEn: "United Kingdom",
    region: "longhaul",
    baselineTwd: 31000,
  },
  {
    airport: "CDG",
    cityCode: "par",
    countryCode: "FR",
    flag: "🇫🇷",
    zhTW: "巴黎戴高樂",
    en: "Paris",
    countryZhTW: "法國",
    countryEn: "France",
    region: "longhaul",
    baselineTwd: 31500,
  },
  {
    airport: "FRA",
    cityCode: "fra",
    countryCode: "DE",
    flag: "🇩🇪",
    zhTW: "法蘭克福",
    en: "Frankfurt",
    countryZhTW: "德國",
    countryEn: "Germany",
    region: "longhaul",
    baselineTwd: 32000,
  },
  {
    airport: "AMS",
    cityCode: "ams",
    countryCode: "NL",
    flag: "🇳🇱",
    zhTW: "阿姆斯特丹",
    en: "Amsterdam",
    countryZhTW: "荷蘭",
    countryEn: "Netherlands",
    region: "longhaul",
    baselineTwd: 32500,
  },
  {
    airport: "IST",
    cityCode: "ist",
    countryCode: "TR",
    flag: "🇹🇷",
    zhTW: "伊斯坦堡",
    en: "Istanbul",
    countryZhTW: "土耳其",
    countryEn: "Turkey",
    region: "longhaul",
    baselineTwd: 27000,
  },
  {
    airport: "DXB",
    cityCode: "dxb",
    countryCode: "AE",
    flag: "🇦🇪",
    zhTW: "杜拜",
    en: "Dubai",
    countryZhTW: "阿聯",
    countryEn: "UAE",
    region: "longhaul",
    baselineTwd: 26500,
  },
  {
    airport: "LAX",
    cityCode: "lax",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "洛杉磯",
    en: "Los Angeles",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    baselineTwd: 30000,
  },
  {
    airport: "SFO",
    cityCode: "sfo",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "舊金山",
    en: "San Francisco",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    baselineTwd: 31000,
  },
  {
    airport: "JFK",
    cityCode: "nyc",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "紐約甘迺迪",
    en: "New York JFK",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    baselineTwd: 36000,
  },
  {
    airport: "YVR",
    cityCode: "yvr",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "溫哥華",
    en: "Vancouver",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    baselineTwd: 29000,
  },
  {
    airport: "SYD",
    cityCode: "syd",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "雪梨",
    en: "Sydney",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    baselineTwd: 25500,
  },
  {
    airport: "MEL",
    cityCode: "mel",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "墨爾本",
    en: "Melbourne",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    baselineTwd: 25000,
  },
  {
    airport: "AKL",
    cityCode: "akl",
    countryCode: "NZ",
    flag: "🇳🇿",
    zhTW: "奧克蘭",
    en: "Auckland",
    countryZhTW: "紐西蘭",
    countryEn: "New Zealand",
    region: "longhaul",
    baselineTwd: 29500,
  },
];

const DESTINATION_BY_AIRPORT = new Map<string, DestinationMeta>(
  DESTINATION_CATALOG.map((item) => [item.airport, item]),
);

const AIRPORT_CITY_MAP = new Map<string, string>([
  ...FLIGHT_ORIGINS.map((o) => [o, ORIGIN_META[o].cityCode] as const),
  ...DESTINATION_CATALOG.map((d) => [d.airport, d.cityCode] as const),
  ["ITM", "osa"],
  ["PKX", "bjs"],
  ["LCY", "lon"],
  ["LGW", "lon"],
  ["STN", "lon"],
  ["LTN", "lon"],
  ["ORY", "par"],
  ["LGA", "nyc"],
  ["EWR", "nyc"],
  ["IAD", "was"],
  ["DCA", "was"],
]);

/** Looks up rich metadata for a destination IATA code, returning null if unknown. */
export function getDestinationMeta(airport: string): DestinationMeta | null {
  return DESTINATION_BY_AIRPORT.get(airport.toUpperCase()) ?? null;
}

/** City-only names for cities whose airport name carries a suffix (`東京成田` -> `東京`). */
const CITY_NAMES: Readonly<Record<string, { zhTW: string; en: string }>> = {
  tyo: { zhTW: "東京", en: "Tokyo" },
  osa: { zhTW: "大阪", en: "Osaka" },
  spk: { zhTW: "札幌", en: "Sapporo" },
  oka: { zhTW: "沖繩", en: "Okinawa" },
  sel: { zhTW: "首爾", en: "Seoul" },
  bkk: { zhTW: "曼谷", en: "Bangkok" },
  sha: { zhTW: "上海", en: "Shanghai" },
  bjs: { zhTW: "北京", en: "Beijing" },
  lon: { zhTW: "倫敦", en: "London" },
  par: { zhTW: "巴黎", en: "Paris" },
  nyc: { zhTW: "紐約", en: "New York" },
};

/** City-only display name for a destination airport (airports of one city share it). */
export function getCityName(airport: string, lang: "zh-TW" | "en"): string {
  const meta = getDestinationMeta(airport);
  if (meta === null) return airport.toUpperCase();
  const city = CITY_NAMES[meta.cityCode];
  const names = city ?? meta;
  return lang === "en" ? names.en : names.zhTW;
}

/** Resolves Trip.com city code from an IATA airport code. */
export function airportCityCode(airport: string): string {
  const upper = airport.toUpperCase();
  return AIRPORT_CITY_MAP.get(upper) ?? upper.toLowerCase();
}

export const AIRLINE_NAMES: Readonly<Record<string, { zhTW: string; en: string }>> = {
  CI: { zhTW: "中華航空", en: "China Airlines" },
  BR: { zhTW: "長榮航空", en: "EVA Air" },
  JX: { zhTW: "星宇航空", en: "STARLUX" },
  IT: { zhTW: "台灣虎航", en: "Tigerair Taiwan" },
  MM: { zhTW: "樂桃航空", en: "Peach" },
  GK: { zhTW: "捷星日本", en: "Jetstar Japan" },
  SL: { zhTW: "泰獅航", en: "Thai Lion Air" },
  FD: { zhTW: "泰亞洲航空", en: "Thai AirAsia" },
  TR: { zhTW: "酷航", en: "Scoot" },
  VZ: { zhTW: "泰越捷航空", en: "Thai Vietjet" },
  AK: { zhTW: "亞洲航空", en: "AirAsia" },
  D7: { zhTW: "全亞洲航空", en: "AirAsia X" },
  "5J": { zhTW: "宿霧太平洋航空", en: "Cebu Pacific" },
  ZE: { zhTW: "易斯達航空", en: "Eastar Jet" },
  "7C": { zhTW: "濟州航空", en: "Jeju Air" },
  LJ: { zhTW: "真航空", en: "Jin Air" },
  TW: { zhTW: "德威航空", en: "T'way Air" },
  BX: { zhTW: "釜山航空", en: "Air Busan" },
  RS: { zhTW: "首爾航空", en: "Air Seoul" },
  KE: { zhTW: "大韓航空", en: "Korean Air" },
  OZ: { zhTW: "韓亞航空", en: "Asiana Airlines" },
  CX: { zhTW: "國泰航空", en: "Cathay Pacific" },
  HX: { zhTW: "香港航空", en: "Hong Kong Airlines" },
  UO: { zhTW: "香港快運", en: "HK Express" },
  NH: { zhTW: "全日空", en: "ANA" },
  JL: { zhTW: "日本航空", en: "Japan Airlines" },
  SQ: { zhTW: "新加坡航空", en: "Singapore Airlines" },
  TG: { zhTW: "泰國航空", en: "Thai Airways" },
  VN: { zhTW: "越南航空", en: "Vietnam Airlines" },
  VJ: { zhTW: "越捷航空", en: "VietJet Air" },
  PR: { zhTW: "菲律賓航空", en: "Philippine Airlines" },
  KL: { zhTW: "荷蘭皇家航空", en: "KLM" },
  AF: { zhTW: "法國航空", en: "Air France" },
  LH: { zhTW: "漢莎航空", en: "Lufthansa" },
  TK: { zhTW: "土耳其航空", en: "Turkish Airlines" },
  EK: { zhTW: "阿聯酋航空", en: "Emirates" },
  UA: { zhTW: "聯合航空", en: "United Airlines" },
  DL: { zhTW: "達美航空", en: "Delta Air Lines" },
  NZ: { zhTW: "紐西蘭航空", en: "Air New Zealand" },
  QF: { zhTW: "澳洲航空", en: "Qantas" },
  CA: { zhTW: "中國國際航空", en: "Air China" },
  MU: { zhTW: "中國東方航空", en: "China Eastern" },
  CZ: { zhTW: "中國南方航空", en: "China Southern" },
};

/** Formats an airline IATA code to its localized display name. */
export function getAirlineName(code: string, lang: "zh-TW" | "en"): string {
  const entry = AIRLINE_NAMES[code.toUpperCase()];
  if (entry === undefined) return code.toUpperCase();
  return lang === "en" ? entry.en : entry.zhTW;
}

export interface TaiwanHoliday {
  id: string;
  emoji: string;
  startDate: string;
  endDate: string;
  zhTW: string;
  en: string;
}

export const TAIWAN_HOLIDAYS: readonly TaiwanHoliday[] = [
  {
    id: "new-year-2026",
    emoji: "🎆",
    startDate: "2026-01-01",
    endDate: "2026-01-04",
    zhTW: "元旦",
    en: "New Year",
  },
  {
    id: "cny-2026",
    emoji: "🧧",
    startDate: "2026-02-14",
    endDate: "2026-02-22",
    zhTW: "春節連假",
    en: "Lunar New Year",
  },
  {
    id: "228-2026",
    emoji: "🕊️",
    startDate: "2026-02-27",
    endDate: "2026-03-01",
    zhTW: "228連假",
    en: "Peace Memorial",
  },
  {
    id: "qingming-2026",
    emoji: "🌸",
    startDate: "2026-04-03",
    endDate: "2026-04-06",
    zhTW: "清明兒童連假",
    en: "Qingming Break",
  },
  {
    id: "labor-2026",
    emoji: "🧳",
    startDate: "2026-05-01",
    endDate: "2026-05-03",
    zhTW: "勞動連假",
    en: "Labor Day",
  },
  {
    id: "dragon-boat-2026",
    emoji: "🐉",
    startDate: "2026-06-19",
    endDate: "2026-06-21",
    zhTW: "端午連假",
    en: "Dragon Boat",
  },
  {
    id: "mid-autumn-2026",
    emoji: "🌕",
    startDate: "2026-09-25",
    endDate: "2026-09-28",
    zhTW: "中秋連假",
    en: "Mid-Autumn",
  },
  {
    id: "national-day-2026",
    emoji: "🇹🇼",
    startDate: "2026-10-09",
    endDate: "2026-10-11",
    zhTW: "國慶連假",
    en: "National Day",
  },
  {
    id: "new-year-2027",
    emoji: "🎆",
    startDate: "2027-01-01",
    endDate: "2027-01-03",
    zhTW: "元旦連假",
    en: "New Year",
  },
  {
    id: "cny-2027",
    emoji: "🧧",
    startDate: "2027-02-05",
    endDate: "2027-02-10",
    zhTW: "春節連假",
    en: "Lunar New Year",
  },
  {
    id: "228-2027",
    emoji: "🕊️",
    startDate: "2027-02-27",
    endDate: "2027-03-01",
    zhTW: "228連假",
    en: "Peace Memorial",
  },
  {
    id: "qingming-2027",
    emoji: "🌸",
    startDate: "2027-04-03",
    endDate: "2027-04-06",
    zhTW: "清明兒童連假",
    en: "Qingming Break",
  },
  {
    id: "labor-2027",
    emoji: "🧳",
    startDate: "2027-05-01",
    endDate: "2027-05-03",
    zhTW: "勞動連假",
    en: "Labor Day",
  },
  {
    id: "dragon-boat-2027",
    emoji: "🐉",
    startDate: "2027-06-09",
    endDate: "2027-06-13",
    zhTW: "端午連假",
    en: "Dragon Boat",
  },
  {
    id: "mid-autumn-2027",
    emoji: "🌕",
    startDate: "2027-09-15",
    endDate: "2027-09-19",
    zhTW: "中秋連假",
    en: "Mid-Autumn",
  },
  {
    id: "national-day-2027",
    emoji: "🇹🇼",
    startDate: "2027-10-09",
    endDate: "2027-10-11",
    zhTW: "國慶連假",
    en: "National Day",
  },
];

/** Returns the first overlapping 2026–2027 Taiwan public holiday for `[outDate, inDate ?? outDate]`. */
export function matchTaiwanHoliday(outDate: string, inDate?: string | null): TaiwanHoliday | null {
  const tripEnd = inDate && inDate.length > 0 ? inDate : outDate;
  for (const holiday of TAIWAN_HOLIDAYS) {
    if (outDate <= holiday.endDate && tripEnd >= holiday.startDate) {
      return holiday;
    }
  }
  return null;
}

const optionalDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  localDateSchema.optional(),
);

export const flightGoQuerySchema = z
  .object({
    origin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "INVALID_AIRPORT"),
    dest: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "INVALID_AIRPORT"),
    outDate: localDateSchema,
    inDate: optionalDateSchema,
    tripType: flightTripTypeSchema.default("rt"),
    lang: z.enum(["zh-TW", "en"]).default("zh-TW"),
  })
  .superRefine((val, ctx) => {
    if (val.tripType === "rt") {
      if (val.inDate === undefined) {
        ctx.addIssue({ code: "custom", message: "RETURN_DATE_REQUIRED", path: ["inDate"] });
        return;
      }
      if (val.inDate < val.outDate) {
        ctx.addIssue({ code: "custom", message: "RETURN_BEFORE_DEPARTURE", path: ["inDate"] });
      }
    }
  });

export type FlightGoQuery = z.infer<typeof flightGoQuerySchema>;

export const dailyFlightItemSchema = z.object({
  id: z.string().min(1),
  origin: flightOriginSchema,
  dest: z.string().regex(/^[A-Z]{3}$/),
  region: flightRegionSchema,
  tripType: flightTripTypeSchema,
  outDate: localDateSchema,
  inDate: localDateSchema.nullable(),
  priceTwd: z.number().int().positive(),
  discountPct: z.number().int().min(0).max(99),
  tag: dealTagSchema,
  airlines: z.array(z.string()).min(1),
  transfers: z.number().int().min(0),
  returnTransfers: z.number().int().min(0).nullable(),
  isRedEye: z.boolean(),
  outboundDep: z.string().nullable(),
  inboundDep: z.string().nullable(),
});

export type DailyFlightItem = z.infer<typeof dailyFlightItemSchema>;

export const dailyFlightsResponseSchema = z.object({
  date: localDateSchema,
  updatedAt: z.string(),
  items: z.array(dailyFlightItemSchema),
  isFallback: z.boolean().optional().default(false),
});

export type DailyFlightsResponse = z.infer<typeof dailyFlightsResponseSchema>;

const COUNTRY_TIMEZONES: Readonly<Record<string, string>> = {
  TW: "Asia/Taipei",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur",
  PH: "Asia/Manila",
  ID: "Asia/Makassar",
  HK: "Asia/Hong_Kong",
  MO: "Asia/Macau",
  CN: "Asia/Shanghai",
  GB: "Europe/London",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  NL: "Europe/Amsterdam",
  TR: "Europe/Istanbul",
  AE: "Asia/Dubai",
  US: "America/Los_Angeles",
  CA: "America/Vancouver",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
};

const AIRPORT_TIMEZONES: Readonly<Record<string, string>> = {
  JFK: "America/New_York",
  LGA: "America/New_York",
  EWR: "America/New_York",
  IAD: "America/New_York",
  DCA: "America/New_York",
  MEL: "Australia/Melbourne",
};

/** Resolves the IANA local timezone for an origin or destination airport IATA code. */
export function getAirportTimeZone(airport: string): string {
  const upper = airport.toUpperCase();
  const specific = AIRPORT_TIMEZONES[upper];
  if (specific !== undefined) return specific;
  const meta = DESTINATION_BY_AIRPORT.get(upper);
  if (meta !== undefined) {
    return COUNTRY_TIMEZONES[meta.countryCode] ?? "Asia/Taipei";
  }
  return "Asia/Taipei";
}

/** Computes local `HH:mm` arrival time in the arrival airport's timezone from departure ISO + minutes. */
export function computeArrivalTimeHm(
  depIso: string | null | undefined,
  durationMinutes: number | null | undefined,
  arrivalAirport: string,
): string | null {
  if (
    !depIso ||
    durationMinutes === null ||
    durationMinutes === undefined ||
    durationMinutes <= 0
  ) {
    return null;
  }
  const normalizedIso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(depIso) ? depIso : `${depIso}+08:00`;
  const depMs = Date.parse(normalizedIso);
  if (Number.isNaN(depMs)) return null;
  const arrMs = depMs + durationMinutes * 60_000;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: getAirportTimeZone(arrivalAirport),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(arrMs));
}

/** True when the flight time falls within 00:00–05:59 local time. */
export function isRedEyeTime(isoOrHm: string | null | undefined): boolean {
  if (typeof isoOrHm !== "string" || isoOrHm.trim() === "") return false;
  const isoMatch = isoOrHm.match(/T(\d{2}):(\d{2})/);
  const hmMatch = isoOrHm.match(/^(\d{2}):(\d{2})/);
  const match = isoMatch ?? hmMatch;
  if (!match) return false;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 5;
}

/** True when any departure or arrival timestamp falls within the red-eye window. */
export function hasRedEyeLeg(times: readonly (string | null | undefined)[]): boolean {
  return times.some((t) => isRedEyeTime(t));
}

/**
 * Discards stale cached fares ("ghost fares") that fail live verification or jump beyond tolerance:
 * live unavailable (`null`) OR both >20% AND >NT$800 above the cached price.
 */
export function isGhostFare(cachedPriceTwd: number, livePriceTwd: number | null): boolean {
  if (livePriceTwd === null) return true;
  return livePriceTwd > cachedPriceTwd * 1.2 && livePriceTwd - cachedPriceTwd > 800;
}

/** Computes discount percentage against typical baseline and assigns deal tier badge. */
export function computeDealSignal(
  priceTwd: number,
  baselineTwd: number,
): { discountPct: number; tag: DealTag } {
  if (baselineTwd <= 0 || priceTwd >= baselineTwd) {
    return { discountPct: 0, tag: "normal" };
  }
  const discountPct = Math.min(99, Math.max(0, Math.round((1 - priceTwd / baselineTwd) * 100)));
  const tag: DealTag = discountPct >= 30 ? "steal" : discountPct >= 15 ? "below_market" : "normal";
  return { discountPct, tag };
}

export interface TripComAffiliateConfig {
  allianceId?: string | undefined;
  sid?: string | undefined;
}

/**
 * Builds the bilingual Trip.com `/flights/showfarefirst` search URL.
 * Always targets fixed hosts (`tw.trip.com` or `www.trip.com`) to prevent open redirects.
 */
export function buildTripComUrl(
  params: {
    origin: string;
    dest: string;
    outDate: string;
    inDate?: string | null | undefined;
    tripType: FlightTripType;
    lang: "zh-TW" | "en";
  },
  affiliate?: TripComAffiliateConfig,
): string {
  const originUpper = params.origin.toUpperCase();
  const destUpper = params.dest.toUpperCase();
  const dcity = airportCityCode(originUpper);
  const acity = airportCityCode(destUpper);

  const isEn = params.lang === "en";
  const host = isEn ? "https://www.trip.com" : "https://tw.trip.com";
  const url = new URL(`${host}/flights/showfarefirst`);

  url.searchParams.set("dcity", dcity);
  url.searchParams.set("acity", acity);
  url.searchParams.set("ddate", params.outDate);
  if (params.tripType === "rt" && params.inDate) {
    url.searchParams.set("rdate", params.inDate);
  }
  url.searchParams.set("triptype", params.tripType);
  url.searchParams.set("class", "ys");
  url.searchParams.set("quantity", "1");
  url.searchParams.set("nonstoponly", "off");
  url.searchParams.set("locale", isEn ? "en-US" : "zh-TW");
  url.searchParams.set("curr", "TWD");
  url.searchParams.set("searchboxarg", "t");
  url.searchParams.set("lowpricesource", "searchform");

  if (originUpper.toLowerCase() !== dcity) {
    url.searchParams.set("dairport", originUpper);
  }
  if (destUpper.toLowerCase() !== acity) {
    url.searchParams.set("aairport", destUpper);
  }

  if (affiliate?.allianceId && affiliate.sid) {
    url.searchParams.set("Allianceid", affiliate.allianceId);
    url.searchParams.set("SID", affiliate.sid);
    url.searchParams.set("trip_sub1", "sprout-daily-flights");
  }

  return url.toString();
}

export interface DailyFlightsFilter {
  region: FlightRegion | "all";
  origin: FlightOrigin | "all";
  /** `"all"` or a destination airport IATA code (e.g. `"NRT"`). */
  dest?: string;
  tripType: FlightTripType | "all";
  /** `"all"`, `"holiday"`, or a `"YYYY-MM"` month prefix. */
  month: string;
  /** `"all"` or an airline IATA code (e.g. `"CI"`). */
  airline?: string;
  directOnly: boolean;
  holidayOnly: boolean;
  /** `"all"`, `"direct"`, or `"transfer"`. Overrides `directOnly` when provided. */
  stops?: FlightStopsFilter;
  /** Maximum TWD fare ceiling (inclusive), or `null` for no limit. */
  maxPriceTwd?: number | null;
  /** Exclude flights with red-eye segments. */
  excludeRedEye?: boolean;
}

/** Filters daily flight deals by user-selected tabs and quick filter chips. */
export function filterDailyFlights(
  items: readonly DailyFlightItem[],
  filter: DailyFlightsFilter,
): DailyFlightItem[] {
  const stopsMode: FlightStopsFilter = filter.stops ?? (filter.directOnly ? "direct" : "all");
  const normalizedDest =
    filter.dest !== undefined && filter.dest !== "all" ? filter.dest.toUpperCase() : null;
  const normalizedAirline =
    filter.airline !== undefined && filter.airline !== "all" ? filter.airline.toUpperCase() : null;
  return items.filter((item) => {
    if (filter.region !== "all" && item.region !== filter.region) return false;
    if (filter.origin !== "all" && item.origin !== filter.origin) return false;
    if (normalizedDest !== null && item.dest.toUpperCase() !== normalizedDest) return false;
    if (filter.tripType !== "all" && item.tripType !== filter.tripType) return false;
    const maxStops = Math.max(item.transfers, item.returnTransfers ?? 0);
    if (stopsMode === "direct" && maxStops > 0) return false;
    if (stopsMode === "transfer" && maxStops === 0) return false;
    if (filter.maxPriceTwd != null && item.priceTwd > filter.maxPriceTwd) return false;
    if (filter.excludeRedEye && item.isRedEye) return false;
    if (normalizedAirline !== null) {
      if (!item.airlines.some((code) => code.toUpperCase() === normalizedAirline)) return false;
    }
    if (filter.holidayOnly || filter.month === "holiday") {
      if (matchTaiwanHoliday(item.outDate, item.inDate) === null) return false;
    }
    if (filter.month !== "all" && filter.month !== "holiday") {
      if (!item.outDate.startsWith(filter.month)) return false;
    }
    return true;
  });
}

/** Natural initial direction when switching to a sort key. */
export function defaultSortDirection(sortBy: FlightSortBy): FlightSortDirection {
  return sortBy === "discount" ? "desc" : "asc";
}

/** Sorts daily flights by TWD price or discount percentage in either direction. */
export function sortDailyFlights(
  items: readonly DailyFlightItem[],
  sortBy: FlightSortBy,
  direction: FlightSortDirection = defaultSortDirection(sortBy),
): DailyFlightItem[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sortBy === "discount") {
      return sign * (a.discountPct - b.discountPct) || a.priceTwd - b.priceTwd;
    }
    return sign * (a.priceTwd - b.priceTwd) || b.discountPct - a.discountPct;
  });
}

/** Departure window of the public board: 14 days to 6 months from `todayIso`, inclusive. */
export function departureBounds(todayIso: string): { from: string; to: string } {
  const [y, m, day] = todayIso.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + 6, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return { from: addDays(todayIso, 14), to: first.toISOString().slice(0, 10) };
}

/** Keeps only fares departing inside the board's window (never under 14 days or over 6 months). */
export function withinDepartureWindow<T extends { outDate: string }>(
  items: readonly T[],
  todayIso: string,
): T[] {
  const { from, to } = departureBounds(todayIso);
  return items.filter((item) => item.outDate >= from && item.outDate <= to);
}

function addDays(baseIso: string, days: number): string {
  const date = new Date(`${baseIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface SeedSpec {
  id: string;
  origin: FlightOrigin;
  dest: string;
  tripType: FlightTripType;
  offsetDays: number | string;
  stayDays?: number;
  priceTwd: number;
  airlines: string[];
  transfers: number;
  returnTransfers: number | null;
  outboundDep: string;
  inboundDep: string | null;
}

const DEFAULT_SEEDS: readonly SeedSpec[] = [
  // Japan
  {
    id: "seed-tpe-oka-mm",
    origin: "TPE",
    dest: "OKA",
    tripType: "rt",
    offsetDays: 24,
    stayDays: 4,
    priceTwd: 4590,
    airlines: ["MM"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "09:40",
    inboundDep: "16:20",
  },
  {
    id: "seed-tpe-nrt-it-redeye",
    origin: "TPE",
    dest: "NRT",
    tripType: "rt",
    offsetDays: 32,
    stayDays: 5,
    priceTwd: 6490,
    airlines: ["IT"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "02:35",
    inboundDep: "20:10",
  },
  {
    id: "seed-khh-kix-ci",
    origin: "KHH",
    dest: "KIX",
    tripType: "rt",
    offsetDays: 41,
    stayDays: 5,
    priceTwd: 7480,
    airlines: ["CI"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "07:20",
    inboundDep: "14:50",
  },
  {
    id: "seed-tpe-fuk-br",
    origin: "TPE",
    dest: "FUK",
    tripType: "rt",
    offsetDays: "2027-02-05",
    stayDays: 5,
    priceTwd: 6990,
    airlines: ["BR"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "08:10",
    inboundDep: "19:00",
  },
  {
    id: "seed-tpe-cts-jx",
    origin: "TPE",
    dest: "CTS",
    tripType: "rt",
    offsetDays: "2027-04-02",
    stayDays: 5,
    priceTwd: 10900,
    airlines: ["JX"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "10:15",
    inboundDep: "15:20",
  },
  {
    id: "seed-tsa-hnd-nh",
    origin: "TSA",
    dest: "HND",
    tripType: "rt",
    offsetDays: 29,
    stayDays: 4,
    priceTwd: 8950,
    airlines: ["NH"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "13:30",
    inboundDep: "12:15",
  },
  // South Korea
  {
    id: "seed-tpe-pus-bx-redeye",
    origin: "TPE",
    dest: "PUS",
    tripType: "rt",
    offsetDays: 21,
    stayDays: 4,
    priceTwd: 4880,
    airlines: ["BX"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "02:50",
    inboundDep: "22:05",
  },
  {
    id: "seed-tpe-icn-ke",
    origin: "TPE",
    dest: "ICN",
    tripType: "rt",
    offsetDays: "2027-02-26",
    stayDays: 4,
    priceTwd: 5990,
    airlines: ["KE"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "12:15",
    inboundDep: "16:30",
  },
  {
    id: "seed-khh-icn-7c",
    origin: "KHH",
    dest: "ICN",
    tripType: "rt",
    offsetDays: 38,
    stayDays: 5,
    priceTwd: 5690,
    airlines: ["7C"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "15:10",
    inboundDep: "11:40",
  },
  {
    id: "seed-tpe-cju-tw",
    origin: "TPE",
    dest: "CJU",
    tripType: "rt",
    offsetDays: 48,
    stayDays: 4,
    priceTwd: 5750,
    airlines: ["TW"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "14:20",
    inboundDep: "11:05",
  },
  // Southeast Asia
  {
    id: "seed-tpe-bkk-fd",
    origin: "TPE",
    dest: "BKK",
    tripType: "rt",
    offsetDays: 27,
    stayDays: 5,
    priceTwd: 5690,
    airlines: ["FD"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "13:50",
    inboundDep: "18:10",
  },
  {
    id: "seed-tpe-dad-vj-ow",
    origin: "TPE",
    dest: "DAD",
    tripType: "ow",
    offsetDays: 19,
    priceTwd: 2680,
    airlines: ["VJ"],
    transfers: 0,
    returnTransfers: null,
    outboundDep: "15:00",
    inboundDep: null,
  },
  {
    id: "seed-tpe-sin-tr-redeye",
    origin: "TPE",
    dest: "SIN",
    tripType: "rt",
    offsetDays: 36,
    stayDays: 4,
    priceTwd: 6780,
    airlines: ["TR"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "01:45",
    inboundDep: "12:55",
  },
  {
    id: "seed-tpe-cnx-jx",
    origin: "TPE",
    dest: "CNX",
    tripType: "rt",
    offsetDays: "2027-06-09",
    stayDays: 5,
    priceTwd: 6880,
    airlines: ["JX"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "13:15",
    inboundDep: "17:40",
  },
  {
    id: "seed-rmq-dad-it",
    origin: "RMQ",
    dest: "DAD",
    tripType: "rt",
    offsetDays: 44,
    stayDays: 5,
    priceTwd: 5990,
    airlines: ["IT"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "07:45",
    inboundDep: "11:25",
  },
  // HK / Macau / China
  {
    id: "seed-tpe-hkg-uo",
    origin: "TPE",
    dest: "HKG",
    tripType: "rt",
    offsetDays: 18,
    stayDays: 3,
    priceTwd: 4180,
    airlines: ["UO"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "10:30",
    inboundDep: "18:45",
  },
  {
    id: "seed-khh-mfm-nx",
    origin: "KHH",
    dest: "MFM",
    tripType: "rt",
    offsetDays: 22,
    stayDays: 3,
    priceTwd: 3890,
    airlines: ["IT"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "11:20",
    inboundDep: "16:10",
  },
  // Long-haul (steal deals even at higher nominal price)
  {
    id: "seed-tpe-lhr-br",
    origin: "TPE",
    dest: "LHR",
    tripType: "rt",
    offsetDays: 55,
    stayDays: 10,
    priceTwd: 19800,
    airlines: ["BR"],
    transfers: 1,
    returnTransfers: 1,
    outboundDep: "09:00",
    inboundDep: "21:35",
  },
  {
    id: "seed-tpe-cdg-af-redeye",
    origin: "TPE",
    dest: "CDG",
    tripType: "rt",
    offsetDays: 63,
    stayDays: 11,
    priceTwd: 20400,
    airlines: ["AF"],
    transfers: 1,
    returnTransfers: 1,
    outboundDep: "00:25",
    inboundDep: "13:15",
  },
  {
    id: "seed-tpe-lax-jx",
    origin: "TPE",
    dest: "LAX",
    tripType: "rt",
    offsetDays: 50,
    stayDays: 9,
    priceTwd: 19600,
    airlines: ["JX"],
    transfers: 0,
    returnTransfers: 0,
    outboundDep: "23:40",
    inboundDep: "00:50",
  },
  {
    id: "seed-tpe-syd-qf",
    origin: "TPE",
    dest: "SYD",
    tripType: "rt",
    offsetDays: 58,
    stayDays: 8,
    priceTwd: 16200,
    airlines: ["QF"],
    transfers: 1,
    returnTransfers: 1,
    outboundDep: "19:30",
    inboundDep: "10:15",
  },
];

/** Builds curated reference daily flight deals relative to `referenceDateIso`. */
export function getDefaultDailyFlights(
  referenceDateIso = new Date().toISOString().slice(0, 10),
): DailyFlightItem[] {
  return DEFAULT_SEEDS.flatMap((seed) => {
    const meta = getDestinationMeta(seed.dest);
    if (meta === null) return [];
    const outDate =
      typeof seed.offsetDays === "string"
        ? seed.offsetDays < referenceDateIso
          ? addDays(referenceDateIso, 30)
          : seed.offsetDays
        : addDays(referenceDateIso, seed.offsetDays);
    const inDate =
      seed.tripType === "rt" && seed.stayDays !== undefined
        ? addDays(outDate, seed.stayDays)
        : null;
    const baseline =
      seed.tripType === "ow"
        ? Math.round(meta.baselineTwd * ONE_WAY_BASELINE_FACTOR)
        : meta.baselineTwd;
    const { discountPct, tag } = computeDealSignal(seed.priceTwd, baseline);
    const isRedEye = hasRedEyeLeg([seed.outboundDep, seed.inboundDep]);

    return [
      {
        id: `${referenceDateIso}-${seed.id}`,
        origin: seed.origin,
        dest: seed.dest,
        region: meta.region,
        tripType: seed.tripType,
        outDate,
        inDate,
        priceTwd: seed.priceTwd,
        discountPct,
        tag,
        airlines: seed.airlines,
        transfers: seed.transfers,
        returnTransfers: seed.returnTransfers,
        isRedEye,
        outboundDep: seed.outboundDep,
        inboundDep: seed.inboundDep,
      },
    ];
  });
}
