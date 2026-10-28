# Research: LINE platform facts for the group expense-splitting app

All facts were read on 2026-10-28. Primary sources only (developers.line.biz).

Note on method: several developers.line.biz pages (notably `/en/reference/messaging-api/`, `/en/reference/liff/`) render their content client-side. For those I read the Markdown source that LINE publishes for the same pages (repository `line/line-developers-docs-source`, path `docs/en/<same path>/index.html.md`, first-party LINE org). Each fact below cites the developers.line.biz URL it belongs to. Anything not stated by the docs is marked UNCONFIRMED.

Context assumed: LIFF app in a LINE Login channel, Messaging API bot, Cloudflare Worker (Hono, Web Crypto only) backend.

## 1. Verifying LIFF ID token / access token on a Worker

### ID token (from `liff.getIDToken()`)

- Send the raw token from `liff.getIDToken()` to the server. Do not trust or send the decoded profile from `liff.getDecodedIDToken()` or `liff.getProfile()`. (https://developers.line.biz/en/docs/liff/using-user-profile/, read 2026-10-28)
- The ID token is valid for one hour after issue. (https://developers.line.biz/en/reference/liff/#get-id-token, read 2026-10-28)
- `openid` scope must be selected on the LIFF app, otherwise no ID token is returned. (https://developers.line.biz/en/reference/liff/#get-id-token and https://developers.line.biz/en/docs/liff/registering-liff-apps/, read 2026-10-28)
- Option A, verify endpoint: `POST https://api.line.me/oauth2/v2.1/verify`, form body `id_token` and `client_id` (required), optional `nonce` and `user_id`. Returns the payload claims. Errors include invalid signature, issuer, audience, nonce, subject, and "IdToken expired." (https://developers.line.biz/en/reference/line-login/#verify-id-token, read 2026-10-28)
- Option B, local verification: header `alg` is `ES256` for LIFF apps (`HS256` only for web login). For ES256, pick the key from the JWK document `https://api.line.me/oauth2/v2.1/certs` whose `kid` matches the header `kid`. `iss` is `https://access.line.me`, `aud` is the channel ID. OpenID configuration: `https://access.line.me/.well-known/openid-configuration`. (https://developers.line.biz/en/docs/line-login/verify-id-token/, read 2026-10-28)
- The docs say to "validate the ID token on the server" unless obtained directly from the LINE Platform; the page defers to OpenID Connect "ID Token Validation" for the full step list and does not enumerate them itself (the page does not state them; treat exact exp/iat clock-skew handling as UNCONFIRMED). (https://developers.line.biz/en/docs/line-login/verify-id-token/, read 2026-10-28)
- Claims: `iss`, `sub` (user ID), `aud` (channel ID), `exp`, `iat`; conditional: `auth_time` (only if `max_age` requested), `nonce` (only if requested), `amr` (may be omitted), `name` and `picture` (need `profile` scope), `email` (needs `email` scope). (https://developers.line.biz/en/docs/line-login/verify-id-token/, read 2026-10-28)
- The JWKS URL lists keys by `kid`; whether the endpoint sends cache headers or how often keys rotate is UNCONFIRMED (not stated on the pages read).

### Access token (from `liff.getAccessToken()`)

- Verify with `GET https://api.line.me/oauth2/v2.1/verify?access_token=...`. Success returns `scope`, `client_id`, `expires_in`; invalid, expired or revoked returns 400. The server must check `client_id` equals its own channel ID and check validity, then may call `GET https://api.line.me/v2/profile` with `Bearer` token (needs `profile` scope) to get `userId`, `displayName`, `pictureUrl`, `statusMessage`. (https://developers.line.biz/en/reference/line-login/#verify-access-token and https://developers.line.biz/en/docs/liff/using-user-profile/, read 2026-10-28)
- Access token is valid 12 hours after issue but can be revoked earlier, e.g. when the user closes the LIFF app. (https://developers.line.biz/en/reference/liff/#get-access-token, read 2026-10-28)
- Tradeoff: the access token path needs a network call to LINE per verify (or per profile fetch) and can be revoked; the ID token can be verified locally with Web Crypto (ES256, P-256) against the JWKS, and carries `sub`, `name`, `picture`. The ID token is only valid one hour, so the client must refresh it by calling `liff.getIDToken()` again; whether it returns a fresh token after expiry in all cases is UNCONFIRMED.

## 2. liff.shareTargetPicker(): prerequisites and limits

- Conditions: the user is logged in, and the share target picker is enabled in the LINE Developers Console. (https://developers.line.biz/en/reference/liff/#share-target-picker, read 2026-10-28)
- Enablement: per channel, on the LIFF tab click **shareTargetPicker**, agree to the "Agreement Regarding Use of Information", click **Enable**. The LIFF app must belong to a LINE Login channel. (https://developers.line.biz/en/docs/liff/developing-liff-apps/#using-share-target-picker, read 2026-10-28)
- Scope: no scope is listed among the conditions (`chat_message.write` belongs to `liff.sendMessages()`). Any scope requirement for shareTargetPicker is therefore UNCONFIRMED beyond the listed conditions. (https://developers.line.biz/en/reference/liff/#share-target-picker, read 2026-10-28)
- Contexts: use `liff.isApiAvailable('shareTargetPicker')` at runtime; the docs give no static list of supported contexts (per-context matrix UNCONFIRMED). (https://developers.line.biz/en/reference/liff/#is-api-available, read 2026-10-28)
- External browser on smartphones: needs an SSO login session. Users logged in through auto login have no SSO session, so the picker may not show and the email-address login screen appears instead; after email+password login the picker works. (https://developers.line.biz/en/reference/liff/#share-target-picker, read 2026-10-28)
- Recipients: groups, friends, chats; OpenChat is excluded. (https://developers.line.biz/en/reference/liff/#share-target-picker, read 2026-10-28)
- Messages: max 5 message objects. Allowed types: text (no `emojis`, no `quoteToken`), image, video (no `trackingId`), audio, location, template and Flex (only URI actions allowed). (https://developers.line.biz/en/reference/liff/#share-target-picker, read 2026-10-28)
- `options.isMultiple` default true; `false` limits one friend but does not prevent repeated sharing. LINE recommends a unique token in the shared URL, verified server-side, to restrict reuse. (same URL, read 2026-10-28)
- Result: resolves `{status: "success"}` when sent; resolves with no value if the user cancels; rejects with `LiffError` on failure. LINE does not provide how many people received the message. (same URL, read 2026-10-28)
- Implication for Invite links: the message appears as sent by the user, and Flex/template buttons can only be URI actions (no postback), so invite Flex should use a LIFF URL or HTTPS URL action.

## 3. Messaging API webhook signature and response time

- Header `x-line-signature`; header name is case-insensitive and may change case without notice. (https://developers.line.biz/en/reference/messaging-api/#request-headers, read 2026-10-28)
- Algorithm: HMAC-SHA256 over the request body with the channel secret (of the specific channel; match `destination`), output base64, UTF-8. Use the exact raw body string; do not parse or reformat before verifying. On mismatch or missing header, do not process and end with an error. (https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/, read 2026-10-28)
- The docs specify no timestamp or replay protection and do not prescribe constant-time comparison (UNCONFIRMED; implement constant-time comparison as our own choice, e.g. `crypto.subtle.verify` with HMAC). (same URL, read 2026-10-28)
- Response time: the webhook reason `request_timeout` is defined as "the bot server didn't return a response within 2 seconds". Return a 2xx; process events asynchronously. (https://developers.line.biz/en/docs/messaging-api/check-webhook-error-statistics/ and https://developers.line.biz/en/docs/messaging-api/receiving-messages/, read 2026-10-28)
- Non-2xx can trigger redelivery if "Webhook redelivery" is enabled (off by default); count/interval undisclosed; duplicates possible (dedupe on `webhookEventId`, order via `timestamp`); long failure may suspend delivery. (https://developers.line.biz/en/docs/messaging-api/receiving-messages/, read 2026-10-28)

## 4. Flex Message and Rich Menu limits

Flex Message (https://developers.line.biz/en/reference/messaging-api/#flex-message, read 2026-10-28):
- `altText` max 1500 characters.
- Carousel: max 12 bubbles; all bubbles in a carousel should have the same `size`.
- Max JSON size for a bubble definition: 30 KB.
- Bubble sizes: `nano`, `micro`, `deca`, `hecto`, `kilo`, `mega`, `giga`; `deca` and `hecto` need LINE 13.6.0+ on iOS/Android (7.17.0+ on PC), otherwise shown as `kilo`. (https://developers.line.biz/en/docs/messaging-api/using-flex-messages/, read 2026-10-28)
- Send/reply: up to 5 message objects per request. (https://developers.line.biz/en/docs/messaging-api/sending-messages/, read 2026-10-28)

Rich Menu (https://developers.line.biz/en/reference/messaging-api/#rich-menu-object, read 2026-10-28):
- Image: JPEG or PNG, width 800 to 2500 px, height at least 250 px, aspect ratio (w/h) at least 1.45, max 1 MB. Image cannot be replaced; create a new menu to change it.
- `chatBarText` max 14 characters; `name` max 300 characters (not shown to users); `areas` max 20.
- Max 1,000 rich menus per Official Account via the Messaging API. Create/delete rate limit 100 requests per hour.
- Default menu: set with the Messaging API (`/v2/bot/user/all/richmenu/{id}`) or in LINE Official Account Manager.
- Per-user menus: link `POST /v2/bot/user/{userId}/richmenu/{richMenuId}`, unlink with DELETE; takes effect immediately. Priority: per-user (API) > default (API) > default (Manager). Bulk link `POST /v2/bot/richmenu/bulk/link` takes max 500 user IDs, processed asynchronously. A non-friend cannot be linked. Rich menus are not shown on LINE for PC. (https://developers.line.biz/en/docs/messaging-api/use-per-user-rich-menus/ and https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/, read 2026-10-28)

## 5. LIFF in an external browser versus the LINE app

- In the LIFF browser (inside LINE) the app can access user data without prompting login, and `liff.init()` logs in automatically; `liff.login()` cannot be called there. (https://developers.line.biz/en/docs/liff/overview/ and https://developers.line.biz/en/reference/liff/#login, read 2026-10-28)
- External browser: call `liff.login()` (or pass `withLoginOnExternalBrowser: true` to `liff.init()`, default false). After login the user is redirected to `redirectUri` (default is the Endpoint URL; it must start with the Endpoint URL or login fails), then call `liff.init()` again to obtain tokens. (https://developers.line.biz/en/reference/liff/#login and https://developers.line.biz/en/reference/liff/#initialize-liff-app, read 2026-10-28)
- Supported external browsers: latest Edge, Chrome, Firefox, Safari. Some APIs are LIFF-browser only (for example `liff.scanCode()`); `liff.closeWindow()` is not guaranteed externally. (https://developers.line.biz/en/docs/liff/overview/ and https://developers.line.biz/en/docs/liff/developing-liff-apps/, read 2026-10-28)
- Launch environment is not guaranteed: a LIFF URL opened outside LINE usually opens in the LINE app through universal/app links on iOS/Android, but may open in an external browser; behavior in non-LINE native WebViews depends on that app. (https://developers.line.biz/en/docs/liff/opening-liff-app/, read 2026-10-28)
- Silent login: LIFF has no documented "silent login" API. Related LINE Login behavior: auto login logs in with no user operation when visiting from LINE's in-app browser or the external browser used for LINE Login while the LINE smartphone app is logged in; it does not work on LINE for PC and can fail (private browsing, OS limits). `amr` of `lineautologin` indicates it. (https://developers.line.biz/en/docs/line-login/integrate-line-login/#line-auto-login, read 2026-10-28) A LIFF-specific silent-login claim is UNCONFIRMED.
- Desktop: no statement found that a desktop Chrome user signing in through LIFF avoids the email/QR login screen; desktop users will see the normal LINE Login (email or QR). Google sign-in is not a LINE feature, so Google sessions are handled outside LINE (our backend).
- Session lifetime in LINE: with LINE 15.12.0+ and `Full` size and module mode off, the app can resume within 12 hours keeping the access token; otherwise the access token expires on close. (https://developers.line.biz/en/docs/liff/developing-liff-apps/#behavior-when-closing-liff-app, read 2026-10-28)
- `liff.getContext()` type is `external` in an external browser and `userId` may be null there. (https://developers.line.biz/en/reference/liff/#get-context, read 2026-10-28)

## 6. LIFF user ID versus Messaging API user ID

- Same provider: the user ID is the same across channel types (LINE Login channel and Messaging API channel). Different provider: different value for the same user. User IDs have the form `U[0-9a-f]{32}`. (https://developers.line.biz/en/docs/messaging-api/getting-user-ids/, read 2026-10-28)
- Glossary: "the user ID is only unique to an individual provider." (https://developers.line.biz/en/glossary/, read 2026-10-28)
- Requirement for our app: the LIFF app's LINE Login channel and the Messaging API channel must be under the same provider; a user ID from another provider is rejected by the Messaging API. (https://developers.line.biz/en/docs/messaging-api/getting-user-ids/ and https://developers.line.biz/en/reference/messaging-api/, read 2026-10-28)
- The ID token `sub` and `GET /v2/profile` `userId` are this same user ID. (https://developers.line.biz/en/docs/line-login/verify-id-token/, read 2026-10-28)
- Google users have no LINE user ID; account linking between a Google identity and a LINE user ID is our design, not covered by LINE docs.

## Recommendation

- Put the LIFF app (LINE Login channel) and the Messaging API bot under one provider so `sub` equals the bot user ID; key LINE users by it.
- Verify the LIFF ID token locally on the Worker (ES256 against `api.line.me/oauth2/v2.1/certs`, check `iss`, `aud`, `exp`), with the verify endpoint as fallback; do not send decoded profiles.
- Verify the webhook with HMAC-SHA256 over the raw body, answer 2xx well under 2 seconds, and handle events with `waitUntil`; dedupe on `webhookEventId`.
- Enable shareTargetPicker per channel; use URI-action-only Flex for Invite links, gate on `isApiAvailable`, and provide a copy-link fallback for external browsers and desktop.
- Rich menu: one default menu (1 MB image, 14-char bar text); per-user menus only if needed.
