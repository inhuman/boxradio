# 002 — Technical plan: buffered playback

**Spec:** [`specify.md`](./specify.md) · **Branch:** `feat/buffered-playback` · **Status:** planned

## Stack

| Layer | Choice | Why |
|---|---|---|
| Transport | `fetch` + `ReadableStream` on the station URL | The only way to read a station's bytes; every station tested answers with `Access-Control-Allow-Origin`. |
| Buffer | Media Source Extensions, `SourceBuffer` type `audio/mpeg` (or `audio/aac` when the station is AAC) | MSE is the only browser API that lets us own the reserve. `MediaSource.isTypeSupported` decides, not the user agent. |
| Fallback | The existing `<audio src=…>` path, untouched | It is what works on iOS; it stays the default when the capability check fails. |
| Placement | A `buffered` module inside `app.js`, ~150 lines | A fourth asset would cost a request on the audio path (constitution §IV.2). |
| Dependencies | None | Nothing new to vendor, nothing to build. |

No new endpoint, no server change beyond accepting one new phase label in telemetry.

## Architecture

```
 dial() ── capability? ──no──► element path (today's code)
   │
   yes
   ▼
 buffered.start(url)                       buffered.pump()
   ├ create MediaSource + object URL         ├ fetch(url, Icy-MetaData: 0)
   ├ audio.src = objectURL                   ├ read → appendBuffer → await updateend
   ├ phase = буферизация                     ├ trim: remove(< playhead − 10 s)
   └ wait for sourceopen                     └ trim/append are serialised in one loop
                     │
                     ├ reserve ≥ 5 s ──► audio.currentTime = buffered.start(0); play()
                     │                      └ phase = эфир (existing `playing` handler)
                     └ fetch/append error ──► fall back to the element path, once
```

### Player module (`buffered`)

- `supported()` — `MediaSource.isTypeSupported('audio/mpeg' | 'audio/aac')` plus `ReadableStream`.
- `start(url, gen)` — new `MediaSource`, `audio.src = URL.createObjectURL(ms)`, waits `sourceopen`,
  adds the `SourceBuffer`, starts the pump. Owns a generation number so a superseded dial cannot
  append into the new buffer.
- `pump()` — one sequential loop: `reader.read()` → `appendBuffer` (await `updateend`) → `trim()`.
  Sequential is deliberate: interleaved `append`/`remove` on one `SourceBuffer` is the classic source
  of `InvalidStateError`, and 128 kbps is far below what the loop can sustain.
- `checkReserve()` — when `buffered.end − buffered.start ≥ RESERVE`, sets `currentTime` to the start
  of the buffer and calls `play()`. This is where the 5 s of delay comes from and where it stays.
- `trim()` — removes buffered media more than 10 s behind the playhead, so a 60-minute session does
  not grow (SC-008).
- `drift()` — if the playhead falls more than 20 s behind the buffered edge, jumps forward to
  `end − RESERVE` (EC-05).
- `stop()` — aborts the fetch, revokes the object URL, ends the MediaSource. Called from
  `closeStream()` so pause/stop releases the connection exactly as before.
- `startTimeout` — 10 s without reaching the reserve rejects the start (EC-03, SC-002).

### Phase machine

- New phase `buffering` with the label `буферизация`; the collector's closed phase set gains it, and
  the dump translates it.
- `dial()` sets `connecting`; the buffered path switches to `buffering` as soon as the pump is
  appending; the existing `playing` handler sets `live`.
- `waiting` while playing sets `buffering`; the next `playing` returns to `live` (US-4).
- The watchdog skips while the phase is `buffering`: the buffer layer owns the timeouts there, and
  the "paused with data" rule would otherwise fire during a deliberate fill.
- Telemetry: the phase record carries the label; the `bufferedMs` reached before `эфир` is reported
  with the transition (SC-007).

## Phases and milestones

**P1 — module and capability check.** `buffered.supported()`, start/pump/append/trim, reserve, stop.
*Done when:* on Chromium a session shows `эфир` with ≥ 4.5 s reserved; on WebKit the module reports
"unsupported" and the element path runs.

**P2 — integration and states.** `dial()` branch, `buffering` phase end to end (client, collector,
dump), `waiting` → `buffering` while playing, watchdog guard, pause/stop teardown.
*Done when:* the header shows `подключение → буферизация → эфир`, telemetry records `buffering`, and
the dump prints it.

**P3 — resilience.** Fetch/append failures fall back once; start timeout; drift jump; memory bound.
*Done when:* CORS-blocked and 404 stations still play via the element path, and a 60-minute run keeps
memory flat.

**P4 — verification and deploy.** 10-minute desktop run with zero gaps; simulated 2 s stall absorbed;
Safari unchanged; payload ≤ 45 KB; push (CI deploys, the collector is already provisioned).

## Constitution check

| Principle | Status |
|---|---|
| **I** — one label per state | Amended to 1.1.0: `буферизация` added, with the 15 s bound. |
| **II** — WebKit/iPhone matrix | OK: WebKit also reports MP3-in-MSE support (verified), so the matrix covers the buffered path there and the fallback is covered by the capability branch. |
| **III** — zero-build frontend | OK: module lives in `app.js`, no dependency, no build step. |
| **IV** — payload, load requests | OK: measured after implementation; no new load request. |
| **V** — testing | OK: muted browser runs, Go tests for the new phase enum. |
| **VI** — audio never through the server | OK: MSE fetches from the station directly; the server is not in the path. |
| **VII** — deploy via CI | OK: no new unit, no new route; the existing deploy ships it. |
| **IX** — no new UI beyond the status label | OK: one label, same live region. |

## Risks and fallbacks

| Risk | Mitigation |
|---|---|
| `appendBuffer` and `remove` racing | One sequential pump owns the `SourceBuffer`; no concurrent operations. |
| A browser's MSE lacks MP3 (some Safari builds) | Capability check fails there; element path unchanged (SC-005). WebKit 26 accepts it, so this is per-build, not per-vendor. |
| Station without CORS | `fetch` rejects; one fallback to the element path (SC-006). |
| Station that ignores `Icy-MetaData: 0` | Frames that do not decode are skipped; if playback never starts, the dial fails and the next attempt uses the element path. |
| Memory growth on long sessions | Trim behind the playhead; the bound is exercised in P3. |
| The extra delay feels broken | `буферизация` is visible from the first second, and the start budget is 8 s (SC-002). |
| A latent bug in the new path | The fallback is one flag away and is exercised by the WebKit matrix on every run. |
