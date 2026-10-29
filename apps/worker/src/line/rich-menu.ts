/**
 * The one static default Rich Menu (decision 14, screen 16): a 3 x 2 grid of six buttons.
 * Five open the LIFF app; 使用幫助 sends the help postback, which the webhook answers.
 * Self-contained (no imports) so `scripts/upload-rich-menu.ts` can run it under Node.
 */

export interface RichMenuBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RichMenuAction =
  | { type: "uri"; label: string; uri: string }
  | { type: "postback"; label: string; data: string; displayText: string };

export interface RichMenu {
  size: { width: number; height: number };
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: { bounds: RichMenuBounds; action: RichMenuAction }[];
}

const WIDTH = 2500;
const HEIGHT = 1686;
const COLUMNS = 3;

/** Must equal HELP_POSTBACK_DATA in events.ts; the Rich Menu test checks it. */
const HELP_DATA = "action=help";

/** The SPA path each LIFF button opens; the app resolves "last used" Group or Trip. */
const BUTTONS: readonly ({ label: string } & ({ path: string } | { help: true }))[] = [
  { label: "快速分帳", path: "/groups?create=running-tab" },
  { label: "我的旅程", path: "/trips/latest" },
  { label: "記一筆", path: "/new" },
  { label: "查看結算", path: "/settle" },
  { label: "邀請夥伴", path: "/invite" },
  { label: "使用幫助", help: true },
];

export function richMenu(liffId: string): RichMenu {
  const rows = Math.ceil(BUTTONS.length / COLUMNS);
  const areas = BUTTONS.map((button, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    // Integer edges; the last column and row absorb the remainder so the grid tiles exactly.
    const x = Math.floor((column * WIDTH) / COLUMNS);
    const y = Math.floor((row * HEIGHT) / rows);
    const bounds = {
      x,
      y,
      width: Math.floor(((column + 1) * WIDTH) / COLUMNS) - x,
      height: Math.floor(((row + 1) * HEIGHT) / rows) - y,
    };
    const action: RichMenuAction =
      "help" in button
        ? { type: "postback", label: button.label, data: HELP_DATA, displayText: button.label }
        : { type: "uri", label: button.label, uri: `https://liff.line.me/${liffId}${button.path}` };
    return { bounds, action };
  });
  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: "小芽分帳 預設選單",
    chatBarText: "小芽快捷選單",
    areas,
  };
}
