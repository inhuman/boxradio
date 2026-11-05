# 001 — Technical plan: playback telemetry

**Spec:** [`specify.md`](./specify.md) · **Branch:** `feat/telemetry` · **Status:** planned 2026-11-05

## Stack

| Layer | Choice | Why |
|---|---|---|
| Client | Plain JS appended to the existing `app.js` | A fourth asset would cost a request on the audio path and break §IV.2. No new file, no module system, no build. |
| Collector | Go 1.26, **stdlib only** (`net/http`, `encoding/json`, `crypto/sha256`, `os`, `time`) plus the `zap` logger already in the repo | The repo vendors its deps; a pure-Go SQLite would mean re-vendoring and migrations for ~1 MB/month of data. None of that is justified. |
| Storage | Append-only **JSONL, one file per UTC day**, `TELEMETRY_DIR` (default `./telemetry`), `0700` | One line per record, append-only, crash-safe enough for this volume, and greppable with or without the tool. |
| Reading | `boxradio -telemetry-dump` (same binary) | One artifact to build and ship; the flag needs no deploy story of its own. |
| Isolation | Collector runs as a **separate systemd unit** (`boxradio-telemetry`), own port `127.0.0.1:8081`, own directory | §IV.4 keeps the static server free of per-request work; this puts the write path in its own process. |
| Transport | `navigator.sendBeacon`, `fetch(keepalive)` fallback | The last records must survive the page being closed (SC-008); a normal XHR does not. |

No new dependency, no build step, no container, no queue, no database.

## Architecture

```
 browser (app.js)                        VPS
 ┌──────────────────────────┐    POST   ┌──────────────────────────────┐
 │ phases ──► ring buffer   │──────────►│ nginx  /api/telemetry        │
 │   │            │         │  /api/   │   └─► 127.0.0.1:8081         │
 │   │            └ pagehide│ telemetry│        boxradio -telemetry    │
 │   └─ budget 12 records   │           │          ├ validate (allow-list)
 └──────────────────────────┘           │          ├ stamp build + recv_at
                                        │          ├ append JSONL (day file)
                                        │          └ prune once a day
                                        │
                                        │ boxradio -telemetry-dump ──► stdout
                                        └──────────────────────────────┘
```

### Client (`app.js`, ~150 lines added)

- `telemetry` object: `enabled`, `sid` (16 random hex, memory only), `seq`, `buffer`, `sent`.
- Gated off entirely when `navigator.globalPrivacyControl === true` or `navigator.doNotTrack === '1'`
  (SC-012). Disabled state is decided once at load and never re-read.
- Hooks at the existing seams — `setPhase`, `dial`, `fail`, `block`, `startPlayback` — not a second
  state model (§I of the constitution).
- `start` record is created on the first playback action, never at load (SC-007).
- Flush triggers: a phase change (debounced 1.5 s), 4 buffered records, `pagehide`,
  `visibilitychange → hidden`. Budget: 12 records, 8 KB per session (SC-005); beyond that, records
  are dropped locally and a single `budget-exhausted` marker is kept.
- Transport: beacon with `application/json`; if unavailable or it returns `false`, one
  `fetch(..., {keepalive:true})` attempt; then silence. No retries, no console output (EC-04, EC-05).

### Collector (`main.go`, new subcommands: `serve` default, `telemetry`, `telemetry-dump`)

- `POST /api/telemetry`: body ≤ 8 KB, ≤ 8 records, strict decode (`DisallowUnknownFields`), enum and
  `sid` format checks, per-session budget (≤ 12 records). Anything else → `204`, nothing stored
  (EC-11). The response is always `204` so a client cannot probe what was accepted.
- **User agent is read from the request header and never stored.** Platform family and browser
  family/version are derived server-side and truncated; the raw string goes nowhere, not even logs.
- `received_at` (server clock) is stamped on every record; the client clock is only used for
  offsets within a session (EC-06).
- **Build stamp:** `sha256(app.js)` truncated to 12 hex, cached by `mtime`, refreshed per request.
  Every record carries it (SC-016).
- Append with `O_APPEND`, one `write` per record, file per UTC day. Dedupe on `(sid, seq)` with a
  bounded in-memory LRU plus a reader-side re-check (SC-009).
- Rate limit: token bucket per source address, 60 requests/minute, in memory only, entries expire
  after 10 minutes; the address is never written to disk (SC-014).
- Retention: prune at start and every 24 h — delete day files older than 30 days (SC-010) and, as a
  backstop, drop oldest files until the directory is under 50 MB.
- Fail-soft: any storage error is logged and answered `204`; the collector never affects the player.

### Record shape (one JSON object per line)

```json
{"v":1,"build":"1c20136","sid":"9f2a…","seq":3,"t":4120,"kind":"phase",
 "from":"retry","to":"live","ms":2100,"attempt":2,"reason":"none","platform":"ios","browser":"safari","browser_ver":"17"}
```

`kind` ∈ `start | phase | attempt | end | budget-exhausted`; `reason` is the closed set from the
spec; `platform`/`browser` are derived, never echoed from the client.

### Reading

`boxradio -telemetry-dump -since 24h [-from … -to …] [-platform ios] [-station "FIP"] [-failed] [-count] [-json]`
prints sessions ordered by `(received_at, seq)`, failures first (SC-015), each with its phase
timeline, first-sound offset and build. `-from/-to` is what makes a 15-minute lookup window
expressible; `-count` groups sessions reaching `эфир` against failing ones per station and platform
(SC-004), so counting stays one command rather than a second tool. `-json` gives raw records for `jq`.

## Operations delta (this is the expensive part — see Risks)

| Piece | Change |
|---|---|
| `deploy/remote-setup.sh` | Write and enable `boxradio-telemetry.service`; add `systemctl restart boxradio-telemetry` to the sudoers line; add an exact-match `location = /api/telemetry` to the vhost (`=` outranks the prefix `location /`). Re-run once on the VPS. |
| `.github/workflows/deploy.yml` | Restart both units. No new artifact: same binary, different argument. |
| VPS state | `TELEMETRY_DIR=/opt/boxradio/telemetry`, created by the collector with `0700`. |
| Docs | `docs/telemetry.md`: reading a session, installing the second unit, and the rollback. |

## Phases and milestones

**P1 — Ingest, storage, dump skeleton (collector only, no client).**
Route, validation, append, build stamp, prune, dump command; Go table tests for each.
*Done when:* a `curl` record lands in the day file, a malformed one is rejected without partial
writes, and `-telemetry-dump` prints it back. Covers SC-009 (partly), SC-010, SC-011 (server side),
EC-11. **Milestone M1.**

**P2 — Client emitter.**
Telemetry object, hooks at phase seams, budgets, beacon/fetch flush, GPC/DNT gate, no request before
the first action; payload allow-list assertion in the harness.
*Done when:* a real WebKit session produces `start → phase(подключение) → phase(эфир)`; with the
collector blocked, the player matrix is unchanged. Covers SC-001…SC-003, SC-005, SC-007, SC-008,
SC-012, SC-016. **Milestone M2** (a session from the phone is visible on the server).

**P3 — Reading and diagnosis.**
Filters, time-range lookup, failures-first ordering, counting per station/platform, session
timeline rendering, and a worked reconstruction of the 2026-11 iOS stuck state (buffered, never
played) from records alone.
*Done when:* the stuck state is recognised from `-telemetry-dump` output in under 5 minutes, without
reading the player code. Covers SC-002, SC-013, SC-015. **Milestone M3.**

**P4 — Hardening and deploy.**
Rate limit, flood test, slow/erroring collector matrix re-run, dedupe under duplicate delivery,
systemd unit + nginx location + sudoers + CI restart, deploy verification (served `app.js` hash).
*Done when:* all 16 spec criteria pass, including SC-006 and SC-014, and a deploy is verified by hash.
Covers SC-006, SC-009, SC-014, EC-04, EC-05, EC-07. **Milestone M4.**

## Constitution check

| Principle | Status |
|---|---|
| **I** — one state vocabulary | OK: hooks reuse `phase`, no parallel model. |
| **II** — WebKit/iPhone matrix | OK: every phase verified there; collector-blocked variant added. |
| **III** — zero-build frontend | OK: code appended to `app.js`, no new asset, no dependency. `app.js` grows ~6 KB as built (28.3 → 34.4 KB, budget 45 KB). |
| **IV** — payload and load requests | OK for payload and SC-007. **Tension with IV.4** — see below. |
| **V** — testing | OK: Go table tests, coverage ratchet, browser matrix, **all tests muted**. |
| **VI** — audio never proxied | OK: the collector sees metadata only, never stream bytes. |
| **VII** — deploy via CI | OK, with one provisioning step: `remote-setup.sh` must run once to create the second unit. |
| **VIII** — language | OK: UI unchanged, code and comments English. |
| **IX** — no new UI | OK: nothing visible changes. |

**The IV.4 tension, stated plainly.** §IV.4 says "the Go server stays a static file server plus
`/healthz`: no stream proxying, transcoding, or per-request computation". Per your decision we do
**not** amend it; instead the static service keeps that shape and the write path lives in a separate
process. That is an *interpretation* of "the Go server" as "the static serving process", not "every
process built from this module". It is defensible, but it is an interpretation of a constitutional
sentence, and §X.3 says a violation is fixed or amended, never waived. **Review item:** if you read
§IV.4 as covering anything built from this repo, the honest move is the PATCH amendment to 1.1.0 and
the collector can then live inside `boxradio` proper. The plan works either way; only the unit count
differs.

## Risks and fallbacks

| Risk | Mitigation / fallback |
|---|---|
| **Ops blast radius** — second unit, nginx location, sudoers, CI change; a failed provisioning run leaves the collector down (player unaffected). | Ship the provisioning change in the same PR; verify on the VPS before merging. If provisioning turns out to be fragile, fall back to in-process ingest **with** the amendment (the option you declined) — the code is identical, only the entry point moves. |
| iOS kills the page before the last flush | Flush on every phase change, not only on `pagehide`; bounded loss is accepted by SC-008. |
| Disk growth if prune fails | Hard 50 MB cap with oldest-first eviction, logged; ingest failure never blocks the player. |
| Cached old `app.js` is stamped with the new build | Accepted (D-4); the deploy-window error is minutes long, and `received_at` shows the window. |
| GPC on by default in Firefox ⇒ no Firefox sessions | Expected by D-3, recorded as EC-15 so nobody debugs it. |
| Raw user agent leaking into logs or files | Derivation lives in one function with a test asserting the raw UA appears in neither the file nor the log output. |
| Rate limiter as a memory growth vector | Bounded map with 10-minute expiry; a flood costs memory, not disk. |
| Ad-blockers filtering `/api/telemetry` | Silent client (EC-05); if measurements later show heavy blocking, the route can be renamed — a deploy, not a redesign. |

## Testing

- **Go:** table tests for `validate`, `deriveClient`, `append`, `prune`, `dump`; `httptest` for the
  route (accept, reject, oversize, flood); coverage ratchet from 22.2%.
- **Browser:** the existing scenario harness, run **muted**, WebKit/iPhone and Chromium, in four
  collector modes — normal, `500`, blocked, 5 s late — asserting: player behaviour unchanged, no
  console output, payload contains only allow-listed fields (SC-011), sequence is monotonic, and the
  stuck-buffer case emits `нажмите ▶` with its buffered duration.
- **Deploy:** served `app.js` hash equals `git hash-object app.js`; a real session from a phone is
  visible in `-telemetry-dump` within a minute.
