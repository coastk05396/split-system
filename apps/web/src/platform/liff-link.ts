/**
 * The LIFF address of a page of this app. Opened in LINE, `liff.line.me/<id>/<path>` starts the
 * page as a LIFF app, so the share picker works; the plain address opens as an ordinary website,
 * where LIFF says the picker is unavailable. Without a LIFF ID the address is returned as is.
 */
export function liffLink(url: string, liffId: string | undefined = import.meta.env.VITE_LIFF_ID) {
  if (liffId === undefined || liffId === "") return url;
  const { pathname, search, hash } = new URL(url);
  return `https://liff.line.me/${liffId}${pathname}${search}${hash}`;
}
