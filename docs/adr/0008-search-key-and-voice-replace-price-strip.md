# The Search key and 語音搜尋 replace the Price Strip, Fare Ticker and Explore page

Supersedes ADR 0007.

Travel mode used to open on an Explore page, with a Fare Ticker above the header and a Price Strip dock below, all fed by Fare Snapshots that a daily job filled with 180 spaced requests to the flight source. Together they were three surfaces, two extra tabs and a background job, and they only ever covered six popular routes from TPE. The User's request was one place to search, with the answers below it.

The bottom nav is now 首頁 / 搜尋 / 追蹤. The raised round 搜尋鍵 opens the 搜尋面板 on a tap, and starts 語音搜尋 on a long press: the recording goes to a speech-to-text provider, the words go through the existing 小芽 prompt parse, and the search runs on its own. Results are one vertical list. The Fare Ticker, Price Strip, Explore page, 航班 tab, prompt capsule, fare carousel, calendar cheap-day dots, Fare Snapshots table, the daily snapshot job and their two read routes are deleted. Fare history, Deal Signals, Price Watches and the highlights stay.

Speech-to-text is Groq Whisper, the provider the project already holds a key for (ADR 0006's Worker already calls Groq for prompt parsing). The Worker receives the audio in one request, forwards it, and keeps neither audio nor words: nothing is written to D1 or logs. The limits are 15 seconds (enforced by the app only, which records at 32 kbit/s), 1 MB (enforced by the Worker) and 6 recordings a minute per User, and the privacy policy names Groq.

Considered and rejected: the browser's own speech recognition (absent in LINE's in-app browser and uneven in Chrome), Workers AI Whisper (a second STT path to run for no gain over the key we already have), and keeping Fare Snapshots for the calendar dots alone (a 4.5-minute daily job for a hint).

The cost is that the long-press voice path needs a microphone and a provider call: where the microphone is missing or refused, the key falls back to the 搜尋面板 with a hint, and a failed recognition asks the User to try again. Real-device behaviour of the microphone in the LINE in-app browser has not been checked.
