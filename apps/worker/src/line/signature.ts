/**
 * Checks `X-Line-Signature`: base64 HMAC-SHA256 of the raw body with the channel secret
 * (decision 05). `crypto.subtle.verify` compares in constant time.
 */
export async function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  const mac = decodeBase64(signature);
  if (mac === null) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, mac, new TextEncoder().encode(rawBody));
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
