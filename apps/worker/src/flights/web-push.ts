import type { WebPushSubscription } from "@split/shared";
import { importJWK, SignJWT } from "jose";
import type { Bindings } from "../env.js";

export interface FlightPushPayload {
  title: string;
  body: string;
  url: string;
}
export type WebPushSender = (
  subscription: WebPushSubscription,
  payload: FlightPushPayload,
  env: Bindings,
  now: number,
) => Promise<number>;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (x) => x.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
async function hkdf(
  input: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(input), "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: new Uint8Array(info) },
      key,
      bits,
    ),
  );
}

/** RFC8291 aes128gcm payload encryption and RFC8292 VAPID authentication. */
export const sendWebPush: WebPushSender = async (subscription, payload, env, now) => {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
    throw new Error("Web Push is not configured");
  const encode = new TextEncoder();
  const receiverPublic = decode(subscription.keys.p256dh);
  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sender = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  if (!("privateKey" in sender)) throw new Error("ECDH key pair unavailable");
  const rawPublic = await crypto.subtle.exportKey("raw", sender.publicKey);
  if (!(rawPublic instanceof ArrayBuffer)) throw new Error("ECDH public key unavailable");
  const senderPublic = new Uint8Array(rawPublic);
  const agreement = { name: "ECDH", public: receiverKey };
  const secret = new Uint8Array(await crypto.subtle.deriveBits(agreement, sender.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(
    secret,
    decode(subscription.keys.auth),
    concat(encode.encode("WebPush: info\0"), receiverPublic, senderPublic),
    256,
  );
  const key = await crypto.subtle.importKey(
    "raw",
    await hkdf(ikm, salt, encode.encode("Content-Encoding: aes128gcm\0"), 128),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const nonce = await hkdf(ikm, salt, encode.encode("Content-Encoding: nonce\0"), 96);
  const plaintext = concat(encode.encode(JSON.stringify(payload)), new Uint8Array([2]));
  if (plaintext.length > 3993) throw new Error("Push payload exceeds one record");
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext),
  );
  const record = new Uint8Array(5);
  new DataView(record.buffer).setUint32(0, 4096);
  record[4] = senderPublic.length;
  const publicKey = decode(env.VAPID_PUBLIC_KEY);
  const signingKey = await importJWK(
    {
      kty: "EC",
      crv: "P-256",
      x: base64url(publicKey.slice(1, 33)),
      y: base64url(publicKey.slice(33)),
      d: env.VAPID_PRIVATE_KEY,
    },
    "ES256",
  );
  const token = await new SignJWT({ sub: env.VAPID_SUBJECT })
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(new URL(subscription.endpoint).origin)
    .setExpirationTime(Math.floor(now / 1000) + 12 * 3600)
    .sign(signingKey);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
    },
    body: concat(salt, record, senderPublic, ciphertext),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  return response.status;
};
