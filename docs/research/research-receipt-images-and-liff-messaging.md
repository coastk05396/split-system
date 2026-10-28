# Research: receipt image storage and LIFF messaging (小芽分帳)

Read on 2026-10-28. Primary sources only (Cloudflare developer docs, LINE developers docs). Anything not confirmed from those is marked **UNCONFIRMED**. Note that the fetch tool summarised pages, so quotes below are as returned by it, not byte-exact copies.

## Verdicts

| Feature | Verdict | Cheapest free option |
|---|---|---|
| (a) Receipt photo on an Expense | **Fits with a change** | R2 private bucket + Worker-proxied reads, if a payment method on file is acceptable (unconfirmed whether needed). If no card at all: store a small (about 60-100 KB) compressed image as a BLOB in D1 with a short retention. |
| (b) "Also send to the current LINE chat" | **Fits with a change** | `liff.sendMessages` (free, appears as sent by the user) only when LIFF is opened from a chat inside the LIFF browser. Fall back to `liff.shareTargetPicker` elsewhere, or hide the checkbox. |

## 1. Receipt photo storage

### 1.1 Cloudflare R2 free allowance
Source: https://developers.cloudflare.com/r2/pricing/ (read 2026-10-28)
- Free each month, Standard storage only: 10 GB-month storage, 1 million Class A operations, 10 million Class B operations.
- Class A includes `PutObject`, `ListObjects`, `CopyObject`. Class B includes `GetObject`, `HeadObject`. `DeleteObject` is free.
- Egress: R2 does not charge for egress ("egressing directly from R2 does not incur data transfer (egress) charges").
- Standard storage has no minimum storage duration (Infrequent Access has 30 days and no free tier).
- Beyond the free amounts, usage is billed ($4.50 per million Class A, $0.36 per million Class B). There is no stated hard cap that stops service at the free limit (UNCONFIRMED; no cap is described on the pricing page).

Also: https://www.cloudflare.com/products/r2/ (read 2026-10-28): "R2 doesn't charge for egress."

### 1.2 Does enabling R2 need a payment method?
**UNCONFIRMED from official docs.**
- https://developers.cloudflare.com/r2/get-started/ (read 2026-10-28): "You need a Cloudflare account with an R2 subscription", added by completing a checkout flow. It also says R2 is "free to get started with included free monthly usage". It does not say whether a payment method is required.
- The pricing page and the R2 product page do not mention a payment method or "no credit card".
- A search result summary of Cloudflare Community threads (user reports, not primary docs) claims the dashboard asks for a card when enabling R2. Treat this as a strong warning, not a fact. Check in the dashboard before committing to R2. If it demands a card, that conflicts with "will not pay for any plan" only in the sense of having a card on file; usage within the free tier is $0.

### 1.3 D1 limits
- https://developers.cloudflare.com/d1/platform/limits/ (read 2026-10-28): Free plan maximum database size 500 MB; 5 GB per account; maximum string, BLOB or row size 2,000,000 bytes (2 MB); 10 databases per account; Time Travel 7 days.
- https://developers.cloudflare.com/d1/platform/pricing/ (read 2026-10-28): Workers Free allows 5 million rows read per day, 100,000 rows written per day, 5 GB total storage; daily limits reset at 00:00 UTC.
- Implication: a few hundred KB fits the 2 MB row cap, but images share the 500 MB database with all expense data.

### 1.4 Other free first-party Cloudflare options
- Cloudflare Images: https://developers.cloudflare.com/images/pricing/ (read 2026-10-28). Free plan gives 5,000 unique transformations per month for images stored elsewhere (such as R2). "Storage in Images is available only with an Images Paid plan." So it is not a free store.
- Workers KV, Durable Objects storage, and other products were **not checked** and are not recommended for images here.

### 1.5 Cost per image against free limits (calculation)
Assumption: 50 Expenses per day, 1 in 5 has a photo, so 10 photos per day, about 300 per month. Photo size 300 KB (the owner's "few hundred KB").
- Storage growth: 300 x 300 KB = about 90 MB per month, about 1.08 GB per year. R2 free is 10 GB-month, so about 9 years of accumulation before storage alone exceeds it (storage is billed as GB-month average, so it is slower than this).
- Class A: about 300 puts per month = 0.03% of 1 million.
- Class B: even 100 views per photo = 30,000 reads per month = 0.3% of 10 million.
- Egress: free.
- D1 alternative: 90 MB per month fills the 500 MB database in about 5.5 months (and expense data also uses it). At 60 KB per image it is about 18 MB per month, about 28 months. Needs a retention job (delete after N days) to stay safe.
- Net: R2 cost per image is effectively $0 within the free allowance; D1 is feasible only with small images and expiry.

### 1.6 Limiting access to Group Members
- Buckets are private by default (https://developers.cloudflare.com/r2/buckets/public-buckets/, read 2026-10-28). Do not enable r2.dev or a custom domain.
- Worker-proxied reads: bind the bucket (`r2_buckets` in Wrangler config) and use `env.BUCKET.get(key)`; returns `null` if missing (https://developers.cloudflare.com/r2/api/workers/workers-api-usage/, read 2026-10-28). The Worker checks group membership (existing LINE auth) before streaming the object. Each read is one Class B operation; still negligible.
- Presigned URLs: valid 1 second to 7 days, work only on the S3 endpoint `<ACCOUNT_ID>.r2.cloudflarestorage.com` (not custom domains), need an R2 API token, and the Workers binding cannot generate them (https://developers.cloudflare.com/r2/api/s3/presigned-urls/, read 2026-10-28). They add secrets and complexity. Proxy reads are simpler and enforce membership on every request.
- Upload via the Worker with `put`. The Workers API page states no object size limit for `put`, only the 128 MB Worker memory limit; a few hundred KB is far below that. R2 platform limits: 5 GiB single-part upload (https://developers.cloudflare.com/r2/platform/limits/, read 2026-10-28).

### 1.7 Retention
- R2 object lifecycle rules can delete objects after N days, optionally by prefix; deletion typically within 24 hours of expiry; deleted objects stop being billable; up to 1,000 rules per bucket (https://developers.cloudflare.com/r2/buckets/object-lifecycles/, read 2026-10-28). Managing rules needs an API token with `Workers R2 Storage Write`. Whether lifecycle rules are free is not stated on that page (UNCONFIRMED; deletes are free per the pricing page).
- Otherwise images can be kept indefinitely, bounded only by the 10 GB-month free storage. For D1, delete rows or the BLOB after a fixed window.
- Recommended: delete the object when its Expense is deleted (free operation), plus an optional lifecycle expiry.

## 2. LINE LIFF messaging

### 2.1 `liff.sendMessages`
Sources: https://developers.line.biz/en/reference/liff/#send-messages and #is-api-available (read 2026-10-28), https://developers.line.biz/en/docs/liff/registering-liff-apps/ (read 2026-10-28).
- Purpose: sends messages on behalf of the user to the chat room where the LIFF app is open.
- Required scope: `chat_message.write` must be enabled on the LIFF app (it may appear under "View all").
- Contexts: works only in the LIFF browser, launched from a 1:1 chat, group chat, or multi-person chat. Not in an external browser. The docs do not separately describe a 1:1 chat with the Official Account versus other 1:1 chats, so OA 1:1 chat is UNCONFIRMED but falls under "1:1 chat".
- Fails with 403 "user doesn't grant required permissions yet" if: opened via Keep Memo, via a URL scheme or website redirect, reloaded from "recently used services", the scope was disabled after a LIFF-to-LIFF transition (the scope is enabled only when the destination is a LIFF URL, not the Endpoint URL), or the user did not grant the scope.
- Message types (max 5 per call): text (no `emojis` or `quoteToken`), sticker, image, video, audio, location, template (URI action only), Flex (URI action only).
- Webhook: Template and Flex messages sent this way trigger no webhook; other types do.
- Authorship: "on behalf of the user", so it appears as sent by the user, not by the Official Account.
- `sendMessages` is not in the `liff.isApiAvailable` list, so you cannot feature-detect it that way; use `liff.getContext()` / try-catch (the `getContext` values were not verified in the pages read; UNCONFIRMED).

### 2.2 Monthly message quota
- https://developers.line.biz/en/docs/messaging-api/pricing/ (read 2026-10-28): push, multicast, broadcast and narrowcast count against the plan, counted per recipient. Reply messages are not counted.
- No LINE page I read states whether `liff.sendMessages` counts. It is not a Messaging API send by the Official Account, and it is sent as the user, so it is not listed among counted methods. **Explicit confirmation is UNCONFIRMED**; the conclusion that it does not count is an inference from the above.
- The Taiwan free quota figure is not on those pages (UNCONFIRMED).

### 2.3 `liff.shareTargetPicker` as an alternative
Source: https://developers.line.biz/en/reference/liff/#share-target-picker and https://developers.line.biz/en/docs/liff/liff-api-overview/ (read 2026-10-28).
- Opens a picker; message is sent to selected groups, friends or chats (not OpenChat), appearing as sent by the user.
- Works in the LIFF browser and in an external browser (external needs an SSO login session; auto login may show an email login screen). User must be logged in and the picker enabled in the LINE Developers Console, with the "Agreement Regarding Use of Information" accepted.
- Message types (max 5): text, image, video, audio, location, template and Flex (URI action only). No sticker.
- Feature-detect with `liff.isApiAvailable("shareTargetPicker")`.
- Trade-off: the user must pick the target each time, so it cannot do "the current chat" silently. Resolves `status: "success"` on send, nothing if cancelled; LINE does not report recipient count.

### 2.4 Which is better for sending a card
- For a one-tap "also send to the current chat" checkbox: `sendMessages` is the match, but only when the LIFF app was opened from a chat in the LIFF browser, with the scope granted. A Flex card is allowed (URI action only).
- When opened from the rich menu, an external browser, or after redirects: `sendMessages` fails; `shareTargetPicker` works but needs a pick.
- The two are not mutually exclusive: use `sendMessages` when it works, offer `shareTargetPicker` as the fallback.

## 3. Verdict detail
- (a) Fits with a change: use R2 (private bucket, Worker-proxied reads, delete with the Expense, optional lifecycle). Check the dashboard to see if R2 activation asks for a card. If it does and that is unacceptable, use D1 BLOBs with strong client-side shrinking (aim under 100 KB) and a retention window, accepting the 500 MB cap risk.
- (b) Fits with a change: the checkbox must be shown only when a chat context is available, `chat_message.write` must be enabled, and a `shareTargetPicker` fallback (or hiding the option) is needed for external browser and non-chat launches. Cost is $0 and no Official Account quota is documented as used (inference).
