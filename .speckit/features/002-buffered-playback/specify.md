# 002 — Buffered playback

**Status:** specified · **Branch:** `feat/buffered-playback` · **Owner:** maintainer

## Why

The desktop player cuts out for one to two seconds, every few minutes. We measured why:
a plain `<audio>` element on a live stream keeps a reserve of only **1.6–2.3 s**, and it does not
buffer more even when paused — Chrome downloads 2.25 s, then goes idle. The cuts match that reserve
almost exactly, and they never reach the 6 s threshold at which the player would call them a failure,
so telemetry shows three clean desktop sessions with nothing in between.

The radio is otherwise healthy: on iOS a session ran 25 minutes without a single interruption, and a
90-second desktop measurement showed no gaps at all — the reserve is simply too thin to absorb a
normal network hiccup.

The only client-side way to hold more than two seconds is to own the bytes: fetch the stream, feed a
Media Source Extensions buffer, and keep a deliberate reserve. That works where MSE accepts MP3/AAC
and the station sends CORS — measured true in Chromium, and true in WebKit (playwright build 26)
as well. Support is a per-browser fact, not a per-vendor one, so the player asks
`MediaSource.isTypeSupported` and falls back to the element path wherever the answer is no.

## What

The player holds **5 seconds of audio in reserve** before it starts, and keeps that reserve while
playing by fetching ahead and trimming what has been played. The reserve absorbs one- and two-second
network stalls instead of turning them into silence.

The listener sees this: after the tap the header shows **`буферизация`** while the reserve fills,
then **`эфир`** when sound starts. If playback later starves and refills, the header returns to
`буферизация` for the duration of the refill — the state is visible, not silent.

## Actors

| Actor | Goal |
|---|---|
| Listener | Hears uninterrupted music; when the player deliberately waits, it says so. |
| Maintainer | One playback path with a capability check, and a clean fallback when the browser cannot do it. |

## User stories

**US-1 — No more one-second holes.**
As a listener on a desktop browser, playback survives ordinary network hiccups instead of going
silent for a second or two.
*Acceptance:* with a simulated stall of 2 s in the stream, sound continues without an audible gap,
and playback resumes at the same position.

**US-2 — The wait is explained.**
As a listener, when the player spends time filling its reserve, the header says `буферизация`, and
it is obviously different from `подключение` (dialling) and `эфир` (sound).
*Acceptance:* the sequence `подключение → буферизация → эфир` is observable in the header and in
telemetry, in that order, on a normal start.

**US-3 — Nothing changes where it cannot work.**
As a listener on a browser whose MSE cannot hold MP3/AAC, the player behaves exactly as today: no
delay, no new failures, no visual difference beyond the status label.
*Acceptance:* the path taken matches `MediaSource.isTypeSupported` — supported means the buffered
path, unsupported means the element path with today's timing.

**US-4 — A stall is visible while it happens.**
As a listener, if the reserve drains anyway, the header shows `буферизация` while it refills rather
than pretending the stream is live.
*Acceptance:* forcing the buffer to drain mid-playback shows `буферизация` until sound resumes.

**US-5 — The reserve is a number, not a hope.**
As the maintainer, I can verify the reserve from telemetry and from a measurement, not by ear.
*Acceptance:* the session record shows the buffered milliseconds reached before `эфир`, and a
10-minute run has zero audible gaps.

## Success criteria

| ID | Criterion |
|---|---|
| SC-001 | On a supporting browser, sound starts only after at least 5 s of audio are buffered (measured reserve at `эфир` ≥ 4.5 s). |
| SC-002 | Start delay stays within 8 s from tap to first sound on a normal connection; beyond 10 s the attempt is abandoned and reported as `нет сигнала`. |
| SC-003 | A simulated 2 s stall produces no audible gap: playback does not stop, and the element does not enter `waiting`. |
| SC-004 | The header shows `буферизация` while the reserve fills and while it refills after a stall, and `эфир` once sound is flowing. |
| SC-005 | The path matches the capability check: if MSE reports MP3/AAC support the buffered path runs, otherwise playback is identical to today's — same start timing, same states, same fallback. |
| SC-006 | A fetch failure (CORS, 404, network) falls back to the element path within one dial, without user action. |
| SC-007 | Telemetry records the `буферизация` phase and the `bufferedMs` reached before `эфир`; the closed phase set in the collector accepts it. |
| SC-008 | Memory is bounded: buffered media older than 10 s behind the playhead is removed, and a 60-minute session does not grow without limit. |
| SC-009 | Payload stays within the constitution's 45 KB (current 34.4 KB; allowance ~10 KB). |
| SC-010 | No new dependency, no build step: the player remains three static assets. |

## Edge cases

| ID | Case | Required behaviour |
|---|---|---|
| EC-01 | Station does not send CORS headers | `fetch` fails; fall back to the element path, unchanged behaviour. |
| EC-02 | Station sends ICY metadata interleaved in the audio | Request `Icy-MetaData: 0`; if metadata still appears, skip frames that do not start with a valid header and keep playing. |
| EC-03 | Network delivers slower than realtime | The reserve never fills; after 10 s the dial fails with `нет сигнала` rather than playing in permanent stutter. |
| EC-04 | Stream ends or the connection drops mid-playback | The dial fails as today; the reconnect rebuilds the MSE buffer from scratch. |
| EC-05 | Playback falls far behind (tab busy) | If the playhead is more than 20 s behind the buffered edge, jump forward to `end − reserve`. |
| EC-06 | Listener presses pause | The fetch is aborted and the buffer released; resuming dials fresh, as today. |
| EC-07 | MediaSource errors on append | Tear down and fall back to the element path for this session; do not loop. |
| EC-08 | Two tabs open | Two independent players; memory bounded per tab. |
| EC-09 | A browser whose MSE does not take MP3/AAC | Capability check fails, element path, no delay; no `буферизация` unless the stream actually stalls. |
| EC-10 | Station is AAC, not MP3 | MSE with the AAC type if supported, otherwise the element path. |

## Out of scope

- Server-side delay or relay: audio never goes through our server (constitution §VI).
- HLS, DASH, codec transcoding or remuxing.
- A user-facing buffer setting; 5 s is fixed.
- iOS/Safari getting the delay — not possible with MSE and MP3, and not needed: iOS showed no cuts.
- Gapless cross-station transitions.

## Decisions

| ID | Decision | Why |
|---|---|---|
| D-1 | 5 s reserve, fixed | Long enough to absorb the observed 1–2 s, short enough that the tap does not feel broken. |
| D-2 | Capability check, not user-agent sniffing | `MediaSource.isTypeSupported` is the honest question. WebKit 26 answers yes and buffered playback works there; older builds answer no and fall back. |
| D-3 | A new `буферизация` phase | The wait is real and must be visible; hiding it would repeat the bug principle I exists to prevent. |
| D-4 | Keep the element path as the fallback | It is what works on iOS; it must not be removed to simplify the new path. |
