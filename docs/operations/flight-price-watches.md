# Flight Price Watch deployment

Apply the regular D1 migrations; Price Watches and browser subscription keys live in the shared database and cascade when a User is deleted. No new paid notification service is used.

Configure the Worker secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in each deployed environment. Generate one P-256 ECDSA key pair outside the repository: the public key is the base64url uncompressed 65-byte point, the private key is the base64url 32-byte scalar, and the subject is an operator contact such as a `mailto:` URI. Keep that pair stable: browser subscriptions bind to its public key. Never commit keys or log browser endpoints/authentication keys. Public-key exposure through the authenticated `/api/v1/flights/vapid-public-key` endpoint is intentional.

The app registers `/push-sw.js` only during an explicit alert subscription. Browsers require HTTPS (or localhost), permission, and Web Push support; on iOS the user must open a supported installed web app. Unsupported browsers show an explanation and do not create a watch. Local tests inject the browser adapter and network sender; they do not send external notifications.

`POST /api/v1/flights/push-subscriptions` accepts HTTPS endpoints on FCM, Mozilla and Apple browser push domains and validates P-256 subscription keys. Other push providers require extending the allowlist after verification. Outbound notifications use RFC 8291 `aes128gcm` payload encryption and RFC 8292 VAPID, with redirects refused and a 10-second send timeout. A browser endpoint returning 404/410 is removed; transient failures keep the watch active.

Daily maintenance expires watches after the departure day or 60 days, checks active watches against cached/live fares, and claims each check atomically. It completes a watch after at least one browser accepts its notification; remaining devices are best effort. Accepted delivery means the push service accepted the message, not that the user saw it. Network failure after remote acceptance can still make acknowledgement uncertain; the claim lease prevents overlapping Cron checks from sending simultaneously. No extra retries run during a check.

Sources: [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) and [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292).
