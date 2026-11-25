import { z } from "zod";
import { localDateSchema } from "./schemas.js";

export const FLIGHT_ORIGINS = ["TPE", "TSA", "KHH"] as const;
export type FlightOrigin = (typeof FLIGHT_ORIGINS)[number];

export const FLIGHT_REGIONS = ["jp", "kr", "sea", "hkmo", "longhaul"] as const;
export type FlightRegion = (typeof FLIGHT_REGIONS)[number];

/** Finer geography inside the Long-haul Flight Region; it lives in the filter sheet, not in the tabs. */
export const LONGHAUL_SUBREGIONS = [
  "europe",
  "north_america",
  "oceania",
  "middle_east_islands",
] as const;
export type LonghaulSubRegion = (typeof LONGHAUL_SUBREGIONS)[number];

export const DEAL_TAGS = ["steal", "below_market", "normal"] as const;
export type DealTag = (typeof DEAL_TAGS)[number];

export const FLIGHT_SORT_OPTIONS = ["price", "discount"] as const;
export type FlightSortBy = (typeof FLIGHT_SORT_OPTIONS)[number];
export type FlightSortDirection = "asc" | "desc";
export type FlightStopsFilter = "all" | "direct" | "transfer";

export const flightOriginSchema = z.enum(FLIGHT_ORIGINS);
export const flightRegionSchema = z.enum(FLIGHT_REGIONS);
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
  /** Set on every Long-haul airport (exactly one sub-region), absent elsewhere. */
  subRegion?: LonghaulSubRegion;
  /** Static typical-high round-trip price in TWD, used only by the curated fallback board; new cities need none. */
  baselineTwd?: number;
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
  {
    airport: "HIJ",
    cityCode: "hij",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "廣島",
    en: "Hiroshima",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11500,
  },
  {
    airport: "HKD",
    cityCode: "hkd",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "函館",
    en: "Hakodate",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 14500,
  },
  {
    airport: "UKB",
    cityCode: "ukb",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "神戶",
    en: "Kobe",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11800,
  },
  {
    airport: "OKJ",
    cityCode: "okj",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "岡山",
    en: "Okayama",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11500,
  },
  {
    airport: "MYJ",
    cityCode: "myj",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "松山",
    en: "Matsuyama",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11800,
  },
  {
    airport: "TAK",
    cityCode: "tak",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "高松",
    en: "Takamatsu",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11500,
  },
  {
    airport: "KMQ",
    cityCode: "kmq",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "小松",
    en: "Komatsu",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 12500,
  },
  {
    airport: "TOY",
    cityCode: "toy",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "富山",
    en: "Toyama",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 12500,
  },
  {
    airport: "ISG",
    cityCode: "isg",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "石垣島",
    en: "Ishigaki",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 9800,
  },
  {
    airport: "KMI",
    cityCode: "kmi",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "宮崎",
    en: "Miyazaki",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11800,
  },
  {
    airport: "NGS",
    cityCode: "ngs",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "長崎",
    en: "Nagasaki",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 11500,
  },
  {
    airport: "OIT",
    cityCode: "oit",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "大分",
    en: "Oita",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 12000,
  },
  {
    airport: "AOJ",
    cityCode: "aoj",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "青森",
    en: "Aomori",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 14500,
  },
  {
    airport: "AKJ",
    cityCode: "akj",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "旭川",
    en: "Asahikawa",
    countryZhTW: "日本",
    countryEn: "Japan",
    region: "jp",
    baselineTwd: 15500,
  },
  {
    airport: "FSZ",
    cityCode: "fsz",
    countryCode: "JP",
    flag: "🇯🇵",
    zhTW: "靜岡",
    en: "Shizuoka",
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
  {
    airport: "HKT",
    cityCode: "hkt",
    countryCode: "TH",
    flag: "🇹🇭",
    zhTW: "普吉島",
    en: "Phuket",
    countryZhTW: "泰國",
    countryEn: "Thailand",
    region: "sea",
    baselineTwd: 10800,
  },
  {
    airport: "HDY",
    cityCode: "hdy",
    countryCode: "TH",
    flag: "🇹🇭",
    zhTW: "合艾",
    en: "Hat Yai",
    countryZhTW: "泰國",
    countryEn: "Thailand",
    region: "sea",
    baselineTwd: 8800,
  },
  {
    airport: "BKI",
    cityCode: "bki",
    countryCode: "MY",
    flag: "🇲🇾",
    zhTW: "沙巴亞庇",
    en: "Kota Kinabalu",
    countryZhTW: "馬來西亞",
    countryEn: "Malaysia",
    region: "sea",
    baselineTwd: 9800,
  },
  {
    airport: "PQC",
    cityCode: "pqc",
    countryCode: "VN",
    flag: "🇻🇳",
    zhTW: "富國島",
    en: "Phu Quoc",
    countryZhTW: "越南",
    countryEn: "Vietnam",
    region: "sea",
    baselineTwd: 10500,
  },
  {
    airport: "CEB",
    cityCode: "ceb",
    countryCode: "PH",
    flag: "🇵🇭",
    zhTW: "宿霧",
    en: "Cebu",
    countryZhTW: "菲律賓",
    countryEn: "Philippines",
    region: "sea",
    baselineTwd: 8500,
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
  {
    airport: "CTU",
    cityCode: "ctu",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "成都",
    en: "Chengdu",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 12500,
  },
  {
    airport: "KMG",
    cityCode: "kmg",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "昆明",
    en: "Kunming",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 12000,
  },
  {
    airport: "HRB",
    cityCode: "hrb",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "哈爾濱",
    en: "Harbin",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 13500,
  },
  {
    airport: "XMN",
    cityCode: "xmn",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "廈門",
    en: "Xiamen",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 8500,
  },
  {
    airport: "CAN",
    cityCode: "can",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "廣州",
    en: "Guangzhou",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 9000,
  },
  {
    airport: "SZX",
    cityCode: "szx",
    countryCode: "CN",
    flag: "🇨🇳",
    zhTW: "深圳",
    en: "Shenzhen",
    countryZhTW: "中國大陸",
    countryEn: "China",
    region: "hkmo",
    baselineTwd: 9000,
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
    subRegion: "europe",
    baselineTwd: 31000,
  },
  {
    airport: "LGW",
    cityCode: "lon",
    countryCode: "GB",
    flag: "🇬🇧",
    zhTW: "倫敦蓋威克",
    en: "London Gatwick",
    countryZhTW: "英國",
    countryEn: "United Kingdom",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 30500,
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
    subRegion: "europe",
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
    subRegion: "europe",
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
    subRegion: "europe",
    baselineTwd: 32500,
  },
  {
    airport: "IST",
    cityCode: "ist",
    countryCode: "TR",
    flag: "🇹🇷",
    zhTW: "伊斯坦堡新機場",
    en: "Istanbul Airport",
    countryZhTW: "土耳其",
    countryEn: "Turkey",
    region: "longhaul",
    subRegion: "middle_east_islands",
    baselineTwd: 27000,
  },
  {
    airport: "SAW",
    cityCode: "ist",
    countryCode: "TR",
    flag: "🇹🇷",
    zhTW: "伊斯坦堡薩比哈",
    en: "Istanbul Sabiha",
    countryZhTW: "土耳其",
    countryEn: "Turkey",
    region: "longhaul",
    subRegion: "middle_east_islands",
    baselineTwd: 26000,
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
    subRegion: "middle_east_islands",
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
    subRegion: "north_america",
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
    subRegion: "north_america",
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
    subRegion: "north_america",
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
    subRegion: "north_america",
    baselineTwd: 29000,
  },
  {
    airport: "YTZ",
    cityCode: "yto",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "多倫多城市",
    en: "Toronto City",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    subRegion: "north_america",
    baselineTwd: 33000,
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
    subRegion: "oceania",
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
    subRegion: "oceania",
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
    subRegion: "oceania",
    baselineTwd: 29500,
  },
  // North America expansion (#211)
  {
    airport: "ATL",
    cityCode: "atl",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "亞特蘭大",
    en: "Atlanta",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "BOS",
    cityCode: "bos",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "波士頓",
    en: "Boston",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "LAS",
    cityCode: "las",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "拉斯維加斯",
    en: "Las Vegas",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "DEN",
    cityCode: "den",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "丹佛",
    en: "Denver",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "SAN",
    cityCode: "san",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "聖地牙哥",
    en: "San Diego",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "PDX",
    cityCode: "pdx",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "波特蘭",
    en: "Portland",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "ANC",
    cityCode: "anc",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "安克拉治",
    en: "Anchorage",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "MIA",
    cityCode: "mia",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "邁阿密",
    en: "Miami",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "IAH",
    cityCode: "hou",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "休士頓",
    en: "Houston",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "MCO",
    cityCode: "orl",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "奧蘭多",
    en: "Orlando",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "YYZ",
    cityCode: "yto",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "多倫多皮爾遜",
    en: "Toronto Pearson",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "YYC",
    cityCode: "yyc",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "卡加利",
    en: "Calgary",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "CUN",
    cityCode: "cun",
    countryCode: "MX",
    flag: "🇲🇽",
    zhTW: "坎昆",
    en: "Cancun",
    countryZhTW: "墨西哥",
    countryEn: "Mexico",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "MEX",
    cityCode: "mex",
    countryCode: "MX",
    flag: "🇲🇽",
    zhTW: "墨西哥城",
    en: "Mexico City",
    countryZhTW: "墨西哥",
    countryEn: "Mexico",
    region: "longhaul",
    subRegion: "north_america",
  },
  // Oceania expansion (#211)
  {
    airport: "BNE",
    cityCode: "bne",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "布里斯本",
    en: "Brisbane",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "ADL",
    cityCode: "adl",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "阿得雷德",
    en: "Adelaide",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "CBR",
    cityCode: "cbr",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "坎培拉",
    en: "Canberra",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "OOL",
    cityCode: "ool",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "黃金海岸",
    en: "Gold Coast",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "CNS",
    cityCode: "cns",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "凱恩斯",
    en: "Cairns",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "HBA",
    cityCode: "hba",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "荷伯特",
    en: "Hobart",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "WLG",
    cityCode: "wlg",
    countryCode: "NZ",
    flag: "🇳🇿",
    zhTW: "威靈頓",
    en: "Wellington",
    countryZhTW: "紐西蘭",
    countryEn: "New Zealand",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "ZQN",
    cityCode: "zqn",
    countryCode: "NZ",
    flag: "🇳🇿",
    zhTW: "皇后鎮",
    en: "Queenstown",
    countryZhTW: "紐西蘭",
    countryEn: "New Zealand",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "FCO",
    cityCode: "fco",
    countryCode: "IT",
    flag: "🇮🇹",
    zhTW: "羅馬",
    en: "Rome",
    countryZhTW: "義大利",
    countryEn: "Italy",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 33000,
  },
  {
    airport: "MAD",
    cityCode: "mad",
    countryCode: "ES",
    flag: "🇪🇸",
    zhTW: "馬德里",
    en: "Madrid",
    countryZhTW: "西班牙",
    countryEn: "Spain",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 32500,
  },
  {
    airport: "PRG",
    cityCode: "prg",
    countryCode: "CZ",
    flag: "🇨🇿",
    zhTW: "布拉格",
    en: "Prague",
    countryZhTW: "捷克",
    countryEn: "Czechia",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 31500,
  },
  {
    airport: "MUC",
    cityCode: "muc",
    countryCode: "DE",
    flag: "🇩🇪",
    zhTW: "慕尼黑",
    en: "Munich",
    countryZhTW: "德國",
    countryEn: "Germany",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 32500,
  },
  {
    airport: "ZRH",
    cityCode: "zrh",
    countryCode: "CH",
    flag: "🇨🇭",
    zhTW: "蘇黎世",
    en: "Zurich",
    countryZhTW: "瑞士",
    countryEn: "Switzerland",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 34000,
  },
  {
    airport: "VCE",
    cityCode: "vce",
    countryCode: "IT",
    flag: "🇮🇹",
    zhTW: "威尼斯",
    en: "Venice",
    countryZhTW: "義大利",
    countryEn: "Italy",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 33500,
  },
  {
    airport: "BGY",
    cityCode: "mil",
    countryCode: "IT",
    flag: "🇮🇹",
    zhTW: "米蘭貝加莫",
    en: "Milan Bergamo",
    countryZhTW: "義大利",
    countryEn: "Italy",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 32500,
  },
  {
    airport: "GVA",
    cityCode: "gva",
    countryCode: "CH",
    flag: "🇨🇭",
    zhTW: "日內瓦",
    en: "Geneva",
    countryZhTW: "瑞士",
    countryEn: "Switzerland",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 34000,
  },
  {
    airport: "KEF",
    cityCode: "kef",
    countryCode: "IS",
    flag: "🇮🇸",
    zhTW: "雷克雅維克",
    en: "Reykjavik",
    countryZhTW: "冰島",
    countryEn: "Iceland",
    region: "longhaul",
    subRegion: "europe",
    baselineTwd: 36000,
  },
  // Europe expansion (#210)
  {
    airport: "BCN",
    cityCode: "bcn",
    countryCode: "ES",
    flag: "🇪🇸",
    zhTW: "巴塞隆納",
    en: "Barcelona",
    countryZhTW: "西班牙",
    countryEn: "Spain",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "MXP",
    cityCode: "mil",
    countryCode: "IT",
    flag: "🇮🇹",
    zhTW: "米蘭馬爾彭薩",
    en: "Milan Malpensa",
    countryZhTW: "義大利",
    countryEn: "Italy",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "VIE",
    cityCode: "vie",
    countryCode: "AT",
    flag: "🇦🇹",
    zhTW: "維也納",
    en: "Vienna",
    countryZhTW: "奧地利",
    countryEn: "Austria",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "BER",
    cityCode: "ber",
    countryCode: "DE",
    flag: "🇩🇪",
    zhTW: "柏林",
    en: "Berlin",
    countryZhTW: "德國",
    countryEn: "Germany",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "BUD",
    cityCode: "bud",
    countryCode: "HU",
    flag: "🇭🇺",
    zhTW: "布達佩斯",
    en: "Budapest",
    countryZhTW: "匈牙利",
    countryEn: "Hungary",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "CPH",
    cityCode: "cph",
    countryCode: "DK",
    flag: "🇩🇰",
    zhTW: "哥本哈根",
    en: "Copenhagen",
    countryZhTW: "丹麥",
    countryEn: "Denmark",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "DUB",
    cityCode: "dub",
    countryCode: "IE",
    flag: "🇮🇪",
    zhTW: "都柏林",
    en: "Dublin",
    countryZhTW: "愛爾蘭",
    countryEn: "Ireland",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "EDI",
    cityCode: "edi",
    countryCode: "GB",
    flag: "🇬🇧",
    zhTW: "愛丁堡",
    en: "Edinburgh",
    countryZhTW: "英國",
    countryEn: "United Kingdom",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "MAN",
    cityCode: "man",
    countryCode: "GB",
    flag: "🇬🇧",
    zhTW: "曼徹斯特",
    en: "Manchester",
    countryZhTW: "英國",
    countryEn: "United Kingdom",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "LIS",
    cityCode: "lis",
    countryCode: "PT",
    flag: "🇵🇹",
    zhTW: "里斯本",
    en: "Lisbon",
    countryZhTW: "葡萄牙",
    countryEn: "Portugal",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "OPO",
    cityCode: "opo",
    countryCode: "PT",
    flag: "🇵🇹",
    zhTW: "波多",
    en: "Porto",
    countryZhTW: "葡萄牙",
    countryEn: "Portugal",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "ATH",
    cityCode: "ath",
    countryCode: "GR",
    flag: "🇬🇷",
    zhTW: "雅典",
    en: "Athens",
    countryZhTW: "希臘",
    countryEn: "Greece",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "BRU",
    cityCode: "bru",
    countryCode: "BE",
    flag: "🇧🇪",
    zhTW: "布魯塞爾",
    en: "Brussels",
    countryZhTW: "比利時",
    countryEn: "Belgium",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "ARN",
    cityCode: "sto",
    countryCode: "SE",
    flag: "🇸🇪",
    zhTW: "斯德哥爾摩",
    en: "Stockholm",
    countryZhTW: "瑞典",
    countryEn: "Sweden",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "OSL",
    cityCode: "osl",
    countryCode: "NO",
    flag: "🇳🇴",
    zhTW: "奧斯陸",
    en: "Oslo",
    countryZhTW: "挪威",
    countryEn: "Norway",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "HEL",
    cityCode: "hel",
    countryCode: "FI",
    flag: "🇫🇮",
    zhTW: "赫爾辛基",
    en: "Helsinki",
    countryZhTW: "芬蘭",
    countryEn: "Finland",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "WAW",
    cityCode: "waw",
    countryCode: "PL",
    flag: "🇵🇱",
    zhTW: "華沙",
    en: "Warsaw",
    countryZhTW: "波蘭",
    countryEn: "Poland",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "NCE",
    cityCode: "nce",
    countryCode: "FR",
    flag: "🇫🇷",
    zhTW: "尼斯",
    en: "Nice",
    countryZhTW: "法國",
    countryEn: "France",
    region: "longhaul",
    subRegion: "europe",
  },
  // Middle East expansion (#210)
  {
    airport: "DOH",
    cityCode: "doh",
    countryCode: "QA",
    flag: "🇶🇦",
    zhTW: "杜哈",
    en: "Doha",
    countryZhTW: "卡達",
    countryEn: "Qatar",
    region: "longhaul",
    subRegion: "middle_east_islands",
  },
  {
    airport: "CAI",
    cityCode: "cai",
    countryCode: "EG",
    flag: "🇪🇬",
    zhTW: "開羅",
    en: "Cairo",
    countryZhTW: "埃及",
    countryEn: "Egypt",
    region: "longhaul",
    subRegion: "middle_east_islands",
  },
  {
    airport: "AMM",
    cityCode: "amm",
    countryCode: "JO",
    flag: "🇯🇴",
    zhTW: "安曼",
    en: "Amman",
    countryZhTW: "約旦",
    countryEn: "Jordan",
    region: "longhaul",
    subRegion: "middle_east_islands",
  },
  {
    airport: "ORD",
    cityCode: "chi",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "芝加哥",
    en: "Chicago",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
    baselineTwd: 33000,
  },
  {
    airport: "SEA",
    cityCode: "sea",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "西雅圖",
    en: "Seattle",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
    baselineTwd: 30500,
  },
  {
    airport: "HNL",
    cityCode: "hnl",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "檀香山",
    en: "Honolulu",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
    baselineTwd: 30000,
  },
  {
    airport: "DFW",
    cityCode: "dfw",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "達拉斯",
    en: "Dallas",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
    baselineTwd: 34000,
  },
  {
    airport: "IAD",
    cityCode: "was",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "華盛頓杜勒斯",
    en: "Washington Dulles",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
    baselineTwd: 35500,
  },
  {
    airport: "PHX",
    cityCode: "phx",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "鳳凰城",
    en: "Phoenix",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
    baselineTwd: 33000,
  },
  {
    airport: "YUL",
    cityCode: "yul",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "蒙特婁",
    en: "Montreal",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    subRegion: "north_america",
    baselineTwd: 33000,
  },
  {
    airport: "CHC",
    cityCode: "chc",
    countryCode: "NZ",
    flag: "🇳🇿",
    zhTW: "基督城",
    en: "Christchurch",
    countryZhTW: "紐西蘭",
    countryEn: "New Zealand",
    region: "longhaul",
    subRegion: "oceania",
    baselineTwd: 31000,
  },
  {
    airport: "PER",
    cityCode: "per",
    countryCode: "AU",
    flag: "🇦🇺",
    zhTW: "伯斯",
    en: "Perth",
    countryZhTW: "澳洲",
    countryEn: "Australia",
    region: "longhaul",
    subRegion: "oceania",
    baselineTwd: 24500,
  },
  // Nonstop catalog expansion (#220): no static baseline needed
  {
    airport: "EWR",
    cityCode: "nyc",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "紐約紐華克",
    en: "New York Newark",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "KOA",
    cityCode: "koa",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "科納",
    en: "Kona",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "SLC",
    cityCode: "slc",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "鹽湖城",
    en: "Salt Lake City",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "AUS",
    cityCode: "aus",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "奧斯汀",
    en: "Austin",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "SAT",
    cityCode: "sat",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "聖安東尼奧",
    en: "San Antonio",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "MSP",
    cityCode: "msp",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "明尼亞波利斯",
    en: "Minneapolis",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "PHL",
    cityCode: "phl",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "費城",
    en: "Philadelphia",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "BNA",
    cityCode: "bna",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "納什維爾",
    en: "Nashville",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "PIT",
    cityCode: "pit",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "匹茲堡",
    en: "Pittsburgh",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "FLL",
    cityCode: "mia",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "邁阿密羅德岱堡",
    en: "Miami Fort Lauderdale",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "MSY",
    cityCode: "msy",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "紐奧良",
    en: "New Orleans",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "DTW",
    cityCode: "dtt",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "底特律",
    en: "Detroit",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "TPA",
    cityCode: "tpa",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "坦帕",
    en: "Tampa",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "STL",
    cityCode: "stl",
    countryCode: "US",
    flag: "🇺🇸",
    zhTW: "聖路易",
    en: "St. Louis",
    countryZhTW: "美國",
    countryEn: "United States",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "YOW",
    cityCode: "yow",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "渥太華",
    en: "Ottawa",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "YHZ",
    cityCode: "yhz",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "哈利法克斯",
    en: "Halifax",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "YWG",
    cityCode: "ywg",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "溫尼伯",
    en: "Winnipeg",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "YEG",
    cityCode: "yea",
    countryCode: "CA",
    flag: "🇨🇦",
    zhTW: "艾德蒙頓",
    en: "Edmonton",
    countryZhTW: "加拿大",
    countryEn: "Canada",
    region: "longhaul",
    subRegion: "north_america",
  },
  {
    airport: "NAP",
    cityCode: "nap",
    countryCode: "IT",
    flag: "🇮🇹",
    zhTW: "拿坡里",
    en: "Naples",
    countryZhTW: "義大利",
    countryEn: "Italy",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "KRK",
    cityCode: "krk",
    countryCode: "PL",
    flag: "🇵🇱",
    zhTW: "克拉科夫",
    en: "Kraków",
    countryZhTW: "波蘭",
    countryEn: "Poland",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "GLA",
    cityCode: "gla",
    countryCode: "GB",
    flag: "🇬🇧",
    zhTW: "格拉斯哥",
    en: "Glasgow",
    countryZhTW: "英國",
    countryEn: "United Kingdom",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "HAM",
    cityCode: "ham",
    countryCode: "DE",
    flag: "🇩🇪",
    zhTW: "漢堡",
    en: "Hamburg",
    countryZhTW: "德國",
    countryEn: "Germany",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "MLA",
    cityCode: "mla",
    countryCode: "MT",
    flag: "🇲🇹",
    zhTW: "馬爾他",
    en: "Malta",
    countryZhTW: "馬爾他",
    countryEn: "Malta",
    region: "longhaul",
    subRegion: "europe",
  },
  {
    airport: "GUM",
    cityCode: "gum",
    countryCode: "GU",
    flag: "🇬🇺",
    zhTW: "關島",
    en: "Guam",
    countryZhTW: "關島",
    countryEn: "Guam",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "ROR",
    cityCode: "ror",
    countryCode: "PW",
    flag: "🇵🇼",
    zhTW: "帛琉",
    en: "Palau",
    countryZhTW: "帛琉",
    countryEn: "Palau",
    region: "longhaul",
    subRegion: "oceania",
  },
  {
    airport: "SPN",
    cityCode: "spn",
    countryCode: "MP",
    flag: "🇲🇵",
    zhTW: "塞班",
    en: "Saipan",
    countryZhTW: "北馬里亞納群島",
    countryEn: "Northern Mariana Islands",
    region: "longhaul",
    subRegion: "oceania",
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
  ["STN", "lon"],
  ["LTN", "lon"],
  ["ORY", "par"],
  ["LGA", "nyc"],
  ["IAD", "was"],
  ["DCA", "was"],
  // Trip.com lists Fort Lauderdale as its own city, though its City Card groups it with Miami.
  ["FLL", "fll"],
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
  ist: { zhTW: "伊斯坦堡", en: "Istanbul" },
  yto: { zhTW: "多倫多", en: "Toronto" },
  par: { zhTW: "巴黎", en: "Paris" },
  nyc: { zhTW: "紐約", en: "New York" },
  mil: { zhTW: "米蘭", en: "Milan" },
  was: { zhTW: "華盛頓", en: "Washington DC" },
  mia: { zhTW: "邁阿密", en: "Miami" },
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
  Z2: { zhTW: "菲律賓亞洲航空", en: "AirAsia PH" },
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
  "3U": { zhTW: "四川航空", en: "Sichuan Air" },
  MF: { zhTW: "廈門航空", en: "Xiamen Air" },
  HU: { zhTW: "海南航空", en: "Hainan Air" },
  ZH: { zhTW: "深圳航空", en: "Shenzhen Air" },
  "8L": { zhTW: "祥鵬航空", en: "Lucky Air" },
  "9C": { zhTW: "春秋航空", en: "Spring Air" },
  HO: { zhTW: "吉祥航空", en: "Juneyao Air" },
  NX: { zhTW: "澳門航空", en: "Air Macau" },
  "7G": { zhTW: "星悅航空", en: "StarFlyer" },
  BC: { zhTW: "天馬航空", en: "Skymark" },
  IJ: { zhTW: "春秋航空日本", en: "Spring Japan" },
  JQ: { zhTW: "捷星航空", en: "Jetstar" },
  "3K": { zhTW: "捷星亞洲航空", en: "Jetstar Asia" },
  MH: { zhTW: "馬來西亞航空", en: "Malaysia Air" },
  OD: { zhTW: "峇迪航空", en: "Batik Air" },
  GA: { zhTW: "印尼鷹航", en: "Garuda" },
  QR: { zhTW: "卡達航空", en: "Qatar Airways" },
  EY: { zhTW: "阿提哈德航空", en: "Etihad" },
  AY: { zhTW: "芬蘭航空", en: "Finnair" },
  LX: { zhTW: "瑞士國際航空", en: "Swiss" },
  OS: { zhTW: "奧地利航空", en: "Austrian" },
  SK: { zhTW: "北歐航空", en: "SAS" },
  BA: { zhTW: "英國航空", en: "British Airways" },
  IB: { zhTW: "伊比利航空", en: "Iberia" },
  AZ: { zhTW: "義大利航空", en: "ITA Airways" },
  AC: { zhTW: "加拿大航空", en: "Air Canada" },
  AS: { zhTW: "阿拉斯加航空", en: "Alaska Air" },
  AA: { zhTW: "美國航空", en: "American" },
  HA: { zhTW: "夏威夷航空", en: "Hawaiian Air" },
  WS: { zhTW: "西捷航空", en: "WestJet" },
  FI: { zhTW: "冰島航空", en: "Icelandair" },
  VS: { zhTW: "維珍大西洋航空", en: "Virgin Atlantic" },
  LO: { zhTW: "波蘭航空", en: "LOT Polish" },
};

/** Formats an airline IATA code to its localized display name. */
export function getAirlineName(code: string, lang: "zh-TW" | "en"): string {
  const entry = AIRLINE_NAMES[code.toUpperCase()];
  // A 2-character code is shown upper-case; a preserved Explore carrier name (see `parseExploreAirlines`) as is.
  if (entry === undefined) return /^[A-Z0-9]{2}$/i.test(code) ? code.toUpperCase() : code;
  return lang === "en" ? entry.en : entry.zhTW;
}

/** Google Explore carrier names that differ from `AIRLINE_NAMES[...].en`, lower-cased. */
const EXPLORE_NAME_ALIASES: Readonly<Record<string, string>> = {
  "peach aviation": "MM",
  "jetstar airways": "JQ",
  "jetstar japan": "GK",
  "etihad airways": "EY",
  "china eastern airlines": "MU",
  "china southern airlines": "CZ",
  "hong kong express": "UO",
  "tigerair taiwan": "IT",
  tigerair: "IT",
  "thai lion air": "SL",
  "thai vietjet air": "VZ",
  "vietjet air": "VJ",
  vietjet: "VJ",
  "cebu pacific": "5J",
  scoot: "TR",
  "starlux airlines": "JX",
  "eva air": "BR",
  "korean air": "KE",
  "malaysia airlines": "MH",
  "singapore airlines": "SQ",
  "all nippon airways": "NH",
  "air asia": "AK",
  airasia: "AK",
};

const EXPLORE_CODE_BY_NAME: ReadonlyMap<string, string> = new Map([
  ...Object.entries(AIRLINE_NAMES).map(([code, names]) => [names.en.toLowerCase(), code] as const),
  ...Object.entries(EXPLORE_NAME_ALIASES),
]);

/**
 * Carriers of one Google Explore fare. A single IATA `airline_code` is stored as is; `"multi"` (or no
 * code) has its combined `airline` string ("A and B", "A, B, and C") split into carriers, known
 * names mapped to IATA codes and unknown names kept verbatim, without repeats and in order.
 */
export function parseExploreAirlines(
  airlineCode: string | null | undefined,
  airlineName: string | null | undefined,
): string[] {
  const code = airlineCode?.trim() ?? "";
  if (/^[A-Za-z0-9]{2}$/.test(code)) return [code.toUpperCase()];
  const names = (airlineName ?? "")
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i)
    .map((name) => name.trim())
    .filter((name) => name !== "" && name.toLowerCase() !== "and");
  return [...new Set(names.map((name) => EXPLORE_CODE_BY_NAME.get(name.toLowerCase()) ?? name))];
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

export const flightGoQuerySchema = z
  .object({
    origin: z.string().trim().toUpperCase().pipe(flightOriginSchema),
    dest: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "INVALID_AIRPORT"),
    outDate: localDateSchema,
    inDate: localDateSchema,
    lang: z.enum(["zh-TW", "en"]).default("zh-TW"),
    nonstopOnly: z
      .literal("1")
      .optional()
      .transform((v) => v === "1"),
  })
  .superRefine((val, ctx) => {
    if (val.inDate < val.outDate) {
      ctx.addIssue({ code: "custom", message: "RETURN_BEFORE_DEPARTURE", path: ["inDate"] });
    }
  });

export type FlightGoQuery = z.infer<typeof flightGoQuerySchema>;

export const dailyFlightItemSchema = z.object({
  id: z.string().min(1),
  origin: flightOriginSchema,
  dest: z.string().regex(/^[A-Z]{3}$/),
  region: flightRegionSchema,
  outDate: localDateSchema,
  inDate: localDateSchema,
  priceTwd: z.number().int().positive(),
  discountPct: z.number().int().min(0).max(99),
  tag: dealTagSchema,
  airlines: z.array(z.string()).min(1),
  transfers: z.number().int().min(0),
});

export type DailyFlightItem = z.infer<typeof dailyFlightItemSchema>;

/** Public Trip.com affiliate parameters: visible in every final Trip.com URL, never secrets. */
export const tripComAffiliateSchema = z.object({
  allianceId: z.string().optional(),
  sid: z.string().optional(),
  /** The account's fixed `trip_sub3` value. */
  sub3: z.string().optional(),
});

export type TripComAffiliateConfig = z.infer<typeof tripComAffiliateSchema>;

export const dailyFlightsResponseSchema = z.object({
  date: localDateSchema,
  updatedAt: z.string(),
  items: z.array(dailyFlightItemSchema),
  isFallback: z.boolean().optional().default(false),
  /** Lets the client build the same Trip.com URL as `GET /flights/go` (ADR 0015). */
  affiliate: tripComAffiliateSchema.optional(),
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
  MX: "America/Mexico_City",
  IT: "Europe/Rome",
  ES: "Europe/Madrid",
  CZ: "Europe/Prague",
  CH: "Europe/Zurich",
  IS: "Atlantic/Reykjavik",
  AT: "Europe/Vienna",
  HU: "Europe/Budapest",
  DK: "Europe/Copenhagen",
  IE: "Europe/Dublin",
  PT: "Europe/Lisbon",
  GR: "Europe/Athens",
  BE: "Europe/Brussels",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  FI: "Europe/Helsinki",
  PL: "Europe/Warsaw",
  QA: "Asia/Qatar",
  EG: "Africa/Cairo",
  JO: "Asia/Amman",
  MT: "Europe/Malta",
  GU: "Pacific/Guam",
  PW: "Pacific/Palau",
  MP: "Pacific/Saipan",
};

const AIRPORT_TIMEZONES: Readonly<Record<string, string>> = {
  JFK: "America/New_York",
  LGA: "America/New_York",
  EWR: "America/New_York",
  IAD: "America/New_York",
  DCA: "America/New_York",
  // North America and Oceania expansion (#211); other airports use their country's default zone
  ATL: "America/New_York",
  BOS: "America/New_York",
  MIA: "America/New_York",
  MCO: "America/New_York",
  IAH: "America/Chicago",
  DEN: "America/Denver",
  ANC: "America/Anchorage",
  YYZ: "America/Toronto",
  YYC: "America/Edmonton",
  CUN: "America/Cancun",
  BNE: "Australia/Brisbane",
  OOL: "Australia/Brisbane",
  CNS: "Australia/Brisbane",
  ADL: "Australia/Adelaide",
  HBA: "Australia/Hobart",
  MEL: "Australia/Melbourne",
  BKI: "Asia/Kuching",
  ORD: "America/Chicago",
  DFW: "America/Chicago",
  HNL: "Pacific/Honolulu",
  PHX: "America/Phoenix",
  YUL: "America/Toronto",
  YTZ: "America/Toronto",
  PER: "Australia/Perth",
  // Nonstop catalog expansion (#220)
  KOA: "Pacific/Honolulu",
  SLC: "America/Denver",
  AUS: "America/Chicago",
  SAT: "America/Chicago",
  MSP: "America/Chicago",
  PHL: "America/New_York",
  BNA: "America/Chicago",
  PIT: "America/New_York",
  FLL: "America/New_York",
  MSY: "America/Chicago",
  DTW: "America/Detroit",
  TPA: "America/New_York",
  STL: "America/Chicago",
  YOW: "America/Toronto",
  YHZ: "America/Halifax",
  YWG: "America/Winnipeg",
  YEG: "America/Edmonton",
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

/**
 * Deal Signal (ADR 0013): the rounded percentage a fare sits below the Route's typical high price,
 * never below 0. Tiers use that rounded value, the one the traveler sees: `steal` from 50%,
 * `below_market` from 15%, otherwise `normal` (shows nothing).
 */
export function computeDealSignal(
  priceTwd: number,
  typicalHighTwd: number,
): { discountPct: number; tag: DealTag } {
  if (typicalHighTwd <= 0 || priceTwd >= typicalHighTwd) {
    return { discountPct: 0, tag: "normal" };
  }
  const discountPct = Math.min(
    99,
    Math.max(0, Math.round(((typicalHighTwd - priceTwd) / typicalHighTwd) * 100)),
  );
  const tag: DealTag = discountPct >= 50 ? "steal" : discountPct >= 15 ? "below_market" : "normal";
  return { discountPct, tag };
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
    inDate: string;
    lang: "zh-TW" | "en";
    /** A Nonstop Fare's link: Trip.com opens filtered to nonstop flights. */
    nonstopOnly?: boolean;
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
  url.searchParams.set("rdate", params.inDate);
  url.searchParams.set("triptype", "rt");
  url.searchParams.set("class", "ys");
  url.searchParams.set("quantity", "1");
  url.searchParams.set("nonstoponly", params.nonstopOnly === true ? "on" : "off");
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
    if (affiliate.sub3) url.searchParams.set("trip_sub3", affiliate.sub3);
  }

  return url.toString();
}

export interface DailyFlightsFilter {
  region: FlightRegion | "all";
  /** `"all"` or a Long-haul sub-region. */
  subRegion?: LonghaulSubRegion | "all";
  /** `"all"` or an ISO country code of the destination (e.g. `"US"`). */
  country?: string;
  origin: FlightOrigin | "all";
  /** `"all"` or a destination airport IATA code (e.g. `"NRT"`). */
  dest?: string;
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
}

/** Filters daily flight deals by user-selected tabs and quick filter chips. */
export function getFlightCityCode(dest: string): string {
  const upper = dest.toUpperCase();
  return (getDestinationMeta(upper)?.cityCode ?? upper).toUpperCase();
}

export function matchesFlightDest(itemDest: string, selectedDest: string): boolean {
  const target = selectedDest.toUpperCase();
  return itemDest.toUpperCase() === target || getFlightCityCode(itemDest) === target;
}

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
    if (filter.subRegion !== undefined && filter.subRegion !== "all") {
      if (getDestinationMeta(item.dest)?.subRegion !== filter.subRegion) return false;
    }
    if (filter.country !== undefined && filter.country !== "all") {
      if (getDestinationMeta(item.dest)?.countryCode !== filter.country) return false;
    }
    if (normalizedDest !== null && !matchesFlightDest(item.dest, normalizedDest)) return false;
    const maxStops = item.transfers;
    if (stopsMode === "direct" && maxStops > 0) return false;
    if (stopsMode === "transfer" && maxStops === 0) return false;
    if (filter.maxPriceTwd != null && item.priceTwd > filter.maxPriceTwd) return false;
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

/** Departure window of the public board: tomorrow to 6 months from `todayIso`, inclusive. */
export function departureBounds(todayIso: string): { from: string; to: string } {
  const [y, m, day] = todayIso.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + 6, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return { from: addDays(todayIso, 1), to: first.toISOString().slice(0, 10) };
}

/** Keeps only fares departing inside the board's window (never today or over 6 months out). */
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
  offsetDays: number | string;
  stayDays: number;
  priceTwd: number;
  airlines: string[];
  transfers: number;
}

const DEFAULT_SEEDS: readonly SeedSpec[] = [
  {
    id: "seed-tpe-oka-mm",
    origin: "TPE",
    dest: "OKA",
    offsetDays: 24,
    stayDays: 4,
    priceTwd: 4590,
    airlines: ["MM"],
    transfers: 0,
  },
  {
    id: "seed-tpe-nrt-it",
    origin: "TPE",
    dest: "NRT",
    offsetDays: 32,
    stayDays: 5,
    priceTwd: 6490,
    airlines: ["IT"],
    transfers: 0,
  },
  {
    id: "seed-khh-kix-ci",
    origin: "KHH",
    dest: "KIX",
    offsetDays: 41,
    stayDays: 5,
    priceTwd: 7480,
    airlines: ["CI"],
    transfers: 0,
  },
  {
    id: "seed-tpe-fuk-br",
    origin: "TPE",
    dest: "FUK",
    offsetDays: "2027-02-05",
    stayDays: 5,
    priceTwd: 6990,
    airlines: ["BR"],
    transfers: 0,
  },
  {
    id: "seed-tpe-cts-jx",
    origin: "TPE",
    dest: "CTS",
    offsetDays: "2027-04-02",
    stayDays: 5,
    priceTwd: 10900,
    airlines: ["JX"],
    transfers: 0,
  },
  {
    id: "seed-tsa-hnd-nh",
    origin: "TSA",
    dest: "HND",
    offsetDays: 29,
    stayDays: 4,
    priceTwd: 8950,
    airlines: ["NH"],
    transfers: 0,
  },
  {
    id: "seed-tpe-pus-bx",
    origin: "TPE",
    dest: "PUS",
    offsetDays: 21,
    stayDays: 4,
    priceTwd: 4880,
    airlines: ["BX"],
    transfers: 0,
  },
  {
    id: "seed-tpe-icn-ke",
    origin: "TPE",
    dest: "ICN",
    offsetDays: "2027-02-26",
    stayDays: 4,
    priceTwd: 5990,
    airlines: ["KE"],
    transfers: 0,
  },
  {
    id: "seed-khh-icn-7c",
    origin: "KHH",
    dest: "ICN",
    offsetDays: 38,
    stayDays: 5,
    priceTwd: 5690,
    airlines: ["7C"],
    transfers: 0,
  },
  {
    id: "seed-tpe-cju-tw",
    origin: "TPE",
    dest: "CJU",
    offsetDays: 48,
    stayDays: 4,
    priceTwd: 5750,
    airlines: ["TW"],
    transfers: 0,
  },
  {
    id: "seed-tpe-bkk-fd",
    origin: "TPE",
    dest: "BKK",
    offsetDays: 27,
    stayDays: 5,
    priceTwd: 5690,
    airlines: ["FD"],
    transfers: 0,
  },
  {
    id: "seed-tpe-sin-tr",
    origin: "TPE",
    dest: "SIN",
    offsetDays: 36,
    stayDays: 4,
    priceTwd: 6780,
    airlines: ["TR"],
    transfers: 0,
  },
  {
    id: "seed-tpe-cnx-jx",
    origin: "TPE",
    dest: "CNX",
    offsetDays: "2027-06-09",
    stayDays: 5,
    priceTwd: 6880,
    airlines: ["JX"],
    transfers: 0,
  },
  {
    id: "seed-tpe-hkg-uo",
    origin: "TPE",
    dest: "HKG",
    offsetDays: 18,
    stayDays: 3,
    priceTwd: 4180,
    airlines: ["UO"],
    transfers: 0,
  },
  {
    id: "seed-khh-mfm-nx",
    origin: "KHH",
    dest: "MFM",
    offsetDays: 22,
    stayDays: 3,
    priceTwd: 3890,
    airlines: ["IT"],
    transfers: 0,
  },
  {
    id: "seed-tpe-lhr-br",
    origin: "TPE",
    dest: "LHR",
    offsetDays: 55,
    stayDays: 10,
    priceTwd: 19800,
    airlines: ["BR"],
    transfers: 1,
  },
  {
    id: "seed-tpe-cdg-af",
    origin: "TPE",
    dest: "CDG",
    offsetDays: 63,
    stayDays: 11,
    priceTwd: 20400,
    airlines: ["AF"],
    transfers: 1,
  },
  {
    id: "seed-tpe-lax-jx",
    origin: "TPE",
    dest: "LAX",
    offsetDays: 50,
    stayDays: 9,
    priceTwd: 19600,
    airlines: ["JX"],
    transfers: 0,
  },
  {
    id: "seed-tpe-syd-qf",
    origin: "TPE",
    dest: "SYD",
    offsetDays: 58,
    stayDays: 8,
    priceTwd: 16200,
    airlines: ["QF"],
    transfers: 1,
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
    const inDate = addDays(outDate, seed.stayDays);
    const { discountPct, tag } = computeDealSignal(seed.priceTwd, meta.baselineTwd ?? 0);

    return [
      {
        id: `${referenceDateIso}-${seed.id}`,
        origin: seed.origin,
        dest: seed.dest,
        region: meta.region,
        outDate,
        inDate,
        priceTwd: seed.priceTwd,
        discountPct,
        tag,
        airlines: seed.airlines,
        transfers: seed.transfers,
      },
    ];
  });
}
