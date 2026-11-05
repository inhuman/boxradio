# 002 — Tasks: buffered playback

Derived from [`plan.md`](./plan.md). 20 tasks, four phases. `◆` critical path, `▲` high risk.

**Critical path:** T002 → T003 → T004 → T008 → T009 → T011 → T016 → T020.

## P1 — The buffer module

- [x] **T001** Add a `buffered` module in `app.js`: `supported()`, generation counter, `stop()` that
      aborts the fetch and revokes the object URL. `(M)`
- [x] **T002** ◆ MSE start: new `MediaSource`, `audio.src = objectURL`, wait `sourceopen`, add a
      `SourceBuffer` with `audio/mpeg`, or `audio/aac` when that is what the station serves. `(M)` ▲
- [x] **T003** ◆ Pump: `fetch(url, { headers: { 'Icy-MetaData': '0' } })`, sequential
      `read → appendBuffer → updateend`, abortable, one owner of the `SourceBuffer`. `(L)` ▲
- [x] **T004** ◆ Reserve: watch `buffered.start/end`, and at 5 s set `currentTime` to the start of the
      buffer and play. `(M)`
- [x] **T005** Trim behind the playhead (10 s) and jump forward when the playhead is 20 s behind the
      buffered edge. `(M)`
- [x] **T006** Start timeout: 10 s without reaching the reserve rejects the start. `(S)`

## P2 — Integration and the visible state

- [x] **T007** Add the `buffering` phase and the `буферизация` label, plus its dot styling. `(S)`
- [x] **T008** ◆ `dial()` chooses the buffered path when `supported()`; the element path otherwise.
      A failed buffered start falls back within the same dial. `(M)`
- [x] **T009** ◆ `waiting` while playing sets `буферизация`, `playing` returns to `эфир`; the watchdog
      skips while buffering. `(M)` ▲
- [x] **T010** `closeStream()` stops the pump, releases the buffer and revokes the URL. `(S)`
- [x] **T011** ◆ Collector: accept `buffering` in the closed phase set, translate it in the dump, update
      the Go validation test. `(S)`
- [x] **T012** Telemetry carries `bufferedMs` on the `буферизация → эфир` transition. `(S)`

## P3 — Resilience

- [x] **T013** Fetch/append failure falls back to the element path once, without a loop. `(M)`
- [x] **T014** Memory bound: a long run does not grow — verify `buffered` stays bounded and old media is
      removed. `(S)`
- [x] **T015** Drift: a playhead far behind jumps forward instead of drifting forever. `(S)`

## P4 — Verification and deploy

- [x] **T016** ◆ Chromium: reserve ≥ 4.5 s at `эфир`; `подключение → буферизация → эфир`; a simulated
      2 s stall leaves no gap; a 10-minute run has zero stalls. `(L)` ▲
- [x] **T017** WebKit/iPhone: identical to today — no delay, no `буферизация`, element path. `(M)`
- [x] **T018** A station without CORS still plays via the element path. `(S)`
- [x] **T019** Payload ≤ 45 KB, no new dependency, no build step. `(S)`
- [x] **T020** ◆ Deploy, then confirm in production: `буферизация` appears, then `эфир`, and the reserve
      is visible in telemetry. `(M)`

## Coverage

| Requirement | Tasks |
|---|---|
| US-1 no more holes | T003, T004, T016 |
| US-2 the wait is explained | T007, T009, T011 |
| US-3 unchanged where unsupported | T008, T017 |
| US-4 stall is visible | T009, T012 |
| US-5 reserve is measurable | T004, T012, T016 |
| SC-001 reserve ≥ 4.5 s | T004, T016 |
| SC-002 start ≤ 8 s, give up at 10 s | T006, T016 |
| SC-003 2 s stall absorbed | T003, T016 |
| SC-004 visible buffering | T007, T009 |
| SC-005 fallback identical | T008, T017 |
| SC-006 fetch failure falls back | T013, T018 |
| SC-007 telemetry records the phase | T011, T012 |
| SC-008 memory bounded | T005, T014 |
| SC-009 payload ≤ 45 KB | T019 |
| SC-010 no dependency | T019 |
| EC-01 no CORS | T013, T018 |
| EC-02 ICY metadata | T003 |
| EC-03 slower than realtime | T006 |
| EC-04 stream ends | T013 |
| EC-05 far behind | T005, T015 |
| EC-06 pause | T010 |
| EC-07 append error | T013 |
| EC-08 two tabs | T001, T014 |
| EC-09 Safari | T008, T017 |
| EC-10 AAC station | T002 |
| D-1 5 s fixed | T004 |
| D-2 capability check | T001, T008 |
| D-3 visible phase | T007, T011 |
| D-4 fallback kept | T008, T017 |

## Risks while executing

- **T003 is where MSE players usually break**: one sequential owner of the `SourceBuffer`, or
  `append` and `remove` start racing and throw.
- **T009 must not fight the watchdog**: during a deliberate fill the element is paused with data, and
  the old "buffered but paused" rule would report `нажмите ▶` after 2.5 s.
- **T020 is the real proof**: production is the only place where the station, the network and the
  browser are all real.
