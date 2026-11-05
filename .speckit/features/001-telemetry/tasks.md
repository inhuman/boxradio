# 001 — Tasks: playback telemetry

Derived from [`plan.md`](./plan.md). Four phases, 31 tasks. Checkboxes are the source of truth for
progress; `/speckit-status` reads them.

**Markers:** `(S)` `(M)` `(L)` = size. `◆` = on the critical path. `▲` = high complexity or the
place where this feature usually fails.

**Critical path:** T002 → T003 → T006 → T007 → T010 → T015 → T016 → T022 → T027 → T028 → T029 → T031.

---

## P1 — Collector foundation (server only, no client code)

Everything here is verifiable with `curl` and `go test`, before the browser is involved. If P1 is
wrong, P2 hides it.

- [x] **T001** Add a `Telemetry` config block (`DIR`, `ADDR`, `RETENTION_DAYS`, `MAX_MB`) with env
      defaults and start-up validation; refuse to start on an unwritable dir. `(S)`
- [x] **T002** ◆ Restructure `main.go` into three modes — `serve` (default, unchanged behaviour),
      `telemetry`, `telemetry-dump` — without touching the serving path. `(M)` ▲
      *Done when:* existing `main_test.go` passes untouched and `GET /` behaves identically.
- [x] **T003** ◆ Define the record envelope and a strict decoder: unknown fields rejected, enums
      checked, `sid` format and `seq` bounds validated. `(M)`
- [x] **T004** Derive platform/browser family and truncated version from the request `User-Agent`;
      never store or log the raw string. `(S)` ▲
      *Done when:* a table test asserts the raw UA appears in neither the stored line nor the log.
- [x] **T005** Compute the build stamp: `sha256(app.js)` truncated to 12 hex, cached by `mtime`. `(S)`
- [x] **T006** ◆ Store: append one JSON line per record with `O_APPEND` into a per-UTC-day file,
      `0700` directory, created on demand. `(M)`
- [x] **T007** ◆ Handler `POST /api/telemetry`: 8 KB body cap, ≤ 8 records, always answer `204`,
      fail-soft on storage errors. `(M)`
- [x] **T008** Deduplicate `(sid, seq)` with a bounded in-memory LRU plus a reader-side check. `(M)`
- [x] **T009** Prune: run at start and every 24 h; delete day files older than 30 days, then evict
      oldest until the directory is under 50 MB. `(M)`
- [x] **T010** ◆ Dump command: `-since` **and a time range `-from`/`-to`** (SC-015 needs the upper
      bound, `-since` alone cannot express a 15-minute window), `-platform`, `-station`, `-failed`,
      **`-count`** (sessions reaching `эфир` vs failing, grouped by station and platform, for SC-004),
      `-json`; failures first, sessions ordered by `(received_at, seq)`. `(L)` ▲
- [x] **T011** Go tests: validation, derivation, append, dedupe, prune, handler accept/reject/oversize.
      Keep the coverage ratchet above 22.2%. `(L)`
- [x] **T012** Manual check for milestone M1: post a valid and an invalid record with `curl`, confirm
      one line lands and nothing partial is written. `(S)`

## P2 — Client emitter (`app.js`)

- [x] **T013** Add the telemetry object: session id in memory only, `seq`, buffer, budget, `enabled`.
      No storage, no cookie. `(M)`
- [x] **T014** Evaluate the GPC/DNT gate once at load; disabled means no code path ever buffers. `(S)`
- [x] **T015** ◆ Hook the existing seams — first playback action creates `start`; `setPhase` emits
      `phase`; `dial`/`fail`/`block` emit `attempt`. No second state model. `(M)`
- [x] **T016** ◆ Flush policy: debounce 1.5 s, flush at 4 buffered records, on `pagehide` and on
      `visibilitychange → hidden`; **coalesce identical consecutive failures within 5 s into one
      record** (EC-07 — without this rule the budget is spent on a flapping stream); enforce
      12 records and 8 KB per session. `(L)` ▲
- [x] **T017** Transport: `sendBeacon` first, one `fetch(keepalive)` fallback, then silence — no
      retries, no console output. `(S)`
- [x] **T018** Emit a single `budget-exhausted` marker instead of the records that no longer fit. `(S)`
- [x] **T019** Payload allow-list test in the harness: an unknown field fails the run. `(M)`
- [x] **T020** Re-run the player matrix (muted, WebKit/iPhone + Chromium) with the collector in four
      modes — normal, 500, blocked, 5 s late — asserting identical behaviour and no console output. `(L)` ▲

## P3 — Reading and diagnosis

- [x] **T021** Dump rendering: first-sound offset, buffered duration, terminal outcome and build per
      session, so the output answers "did sound ever start". `(M)`
- [x] **T022** ◆ Reproduce the 2026-11 iOS stuck state in the harness, then reconstruct it from the
      dump output alone — without reading `app.js`. `(M)` ▲
- [x] **T023** Write `docs/telemetry.md`: how to find a session by time and platform, and what the
      output means. `(S)`

## P4 — Hardening and deploy

- [x] **T024** Per-source token bucket: 60 requests/minute, 10-minute expiry, memory only, address
      never written to disk. `(M)`
- [x] **T025** Flood test at 100× normal volume: other sessions' records survive, memory stays bounded.
      `(M)` ▲
- [x] **T026** Slow/erroring collector matrix re-run; assert the player still passes all seven
      scenarios and the console stays silent. `(S)`
- [x] **T027** ◆ `boxradio-telemetry.service` in `deploy/remote-setup.sh`, sudoers entry for restarting
      it, exact-match `location = /api/telemetry` in the vhost. `(M)` ▲
- [x] **T028** ◆ CI: build once, restart both units, keep the `app.js` hash verification. `(S)`
- [ ] **T029** ◆ Deploy to the VPS, verify the served `app.js` hash, and see a real session from the
      phone in the dump within a minute. `(M)`
- [x] **T030** Document the second unit, `TELEMETRY_DIR`, dump usage and retention (in
      `docs/telemetry.md`; `sdocs/` is gitignored). `(S)`
- [x] **T031** Walk SC-001…SC-016 and record evidence for each, plus a `getconf`-style check that the
      page payload is still under 45 KB. `(M)`

---

## Coverage

Every user story and success criterion has an owner. Nothing here covers dashboards, third-party
analytics or alerting — those are out of scope in `specify.md`, not missing tasks.

| Requirement | Tasks |
|---|---|
| US-1 diagnose a report | T010, T021, T022 |
| US-2 dead station vs broken client | T010, T021 |
| US-3 the invisible failure | T016, T021, T022 |
| US-4 nothing changes for the listener | T020, T026 |
| US-5 privacy by construction | T009, T014, T019 |
| US-6 operate without ceremony | T002, T027, T029, T030 |
| SC-001 reconstruct a session | T003, T006, T010 |
| SC-002 buffered-but-silent outcome | T016, T021, T022 |
| SC-003 failure reasons distinguishable | T003, T015 |
| SC-004 per station / per platform counts | T010 |
| SC-005 volume budget | T016, T018 |
| SC-006 playback unaffected | T020, T026 |
| SC-007 nothing before the first action | T013, T015 |
| SC-008 bounded loss on close | T016 |
| SC-009 ordering and dedupe | T008, T010 |
| SC-010 retention | T009 |
| SC-011 allow-list only | T003, T019 |
| SC-012 GPC/DNT opt-out | T014 |
| SC-013 diagnosis under 5 minutes | T021, T022 |
| SC-014 flood resistance | T024, T025 |
| SC-015 lookup rule | T010, T021 |
| SC-016 build attribution | T005, T021 |
| D-1 retention 30 days | T009 |
| D-2 exact station identity | T003 |
| D-3 GPC + DNT | T014 |
| D-4 build in record | T005 |
| D-5 one feature, read by command | T002, T010 |
| EC-01 no play, no record | T013 |
| EC-02 backgrounded and suspended | T016 |
| EC-03 closed from the app switcher | T016 |
| EC-04 collector down or slow | T017, T020 |
| EC-05 ad-blocker blocks the collector | T017, T020 |
| EC-06 wrong device clock | T003 |
| EC-07 retry coalescing | T016 |
| EC-08 long session | T016 |
| EC-09 two tabs open | T013 |
| EC-10 no storage | T013 |
| EC-11 malformed payload | T003, T007 |
| EC-12 mixed content reason | T015 |
| EC-13 invented session id | T008 |
| EC-14 bad user agent | T004 |
| EC-15 Firefox GPC by default | T014 |
| EC-16 stale client after deploy | T005 |

### Support tasks without a direct requirement

T001 (config), T011 (Go tests), T012 (M1 curl check) and T031 (criterion sweep) are enabling work:
they gate quality rather than implement one requirement. T023 (diagnosis doc) also serves US-6 and
SC-013.

## Remaining

- [x] **T029** Deploy to the VPS and confirm the collector is reachable (done 2026-11-05:
      unit active, `/api/telemetry` answers 204, a record landed with the deployed build hash;
      a session from a real phone is still worth confirming). Previously required running
      `deploy/remote-setup.sh` once (it creates `boxradio-telemetry.service`, the sudoers entry and
      the nginx route). Until then the collector cannot run in production, though the player is
      unaffected: a missing collector means no records, not a broken radio.

## Risks to watch while executing

- **T002 is the quiet one.** Restructuring `main.go` into modes is where the static server can
  regress. Run the existing tests before and after; the serving path must be untouched.
- **T016 is where the spec's budgets are actually met** — not in the handler. If the client buffers
  without a cap, no server cap saves SC-005.
- **T027/T028 are where the feature dies in practice.** Provisioning a second unit is a manual step
  on the VPS; do it before merging, not after.
