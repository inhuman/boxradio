# 001 — Playback telemetry

**Status:** specified · **Branch:** `feat/telemetry` · **Owner:** maintainer (single developer)

## Why

For a whole evening we could not tell what was wrong with the radio on an iPhone. The symptom was
"переподключение and nothing happens", reported from one device, unreproducible on Chromium or on
WebKit without the device's actual audio policy. We had to ask the user what phone they use. The
answer turned out to be a silent state the player had no way to report: full buffer, no sound, no
error, and a header that promised a reconnect forever.

The player is a radio with no accounts, no analytics and no way to observe a real listener's
session. Every failure — a refused `play()`, a station that 404s for one mobile carrier, a stall at
00:40 — is invisible until someone complains, and then the complaint is "не работает" and we start
guessing again.

This feature makes a listening session **reconstructable after the fact**: given a session, we can
see which station was tuned, which phases the player went through, how long each took, and why it
ended where it did. That is the whole product goal — not analytics for growth, but evidence for
debugging.

## What counts as telemetry here

A record of the player's own state machine, per listening session: the phases it visited, their
durations, the failure reason when it failed, and enough context to tell "this station is dead for
everyone" from "this client is broken on this platform".

Nothing else. No clicks, no scroll positions, no page views, no feature usage.

## Actors

| Actor | Goal |
|---|---|
| Listener | Hears the radio. Never learns telemetry exists: no banner, no consent prompt, no UI, no slowdown. |
| Maintainer | Turns a vague report into a diagnosis: which station, which platform, which phase failed, did sound ever start. |
| The player | Records its own transitions while it plays, without being able to break playback. |

## User stories

**US-1 — Diagnose a reported failure.**
As the maintainer, when a listener says "the radio doesn't work on my phone", I can pull the recent
sessions from that platform and see the phase sequence, the terminal phase and the failure reason,
without asking the listener anything beyond roughly when it happened.
*Acceptance:* given a session reference taken from the listener's screen-free report (roughly the
time plus platform), the session is identifiable and shows a complete ordered phase history.

**US-2 — Separate a dead station from a broken client.**
As the maintainer, I can group failures by station and by platform, so that "every station fails on
iOS" and "one station fails everywhere" are visibly different shapes in the data.
*Acceptance:* for any 24-hour window I can answer, per station, how many sessions reached `эфир`
and how many ended in `нет сигнала`, split by platform family.

**US-3 — See the invisible failure.**
As the maintainer, I can recognise the exact state that cost us this week: audio buffered, never
played, no error reported — as its own outcome, distinct from a stream that refused the connection.
*Acceptance:* a session that buffers but never produces sound is reported with a distinct terminal
outcome and the time it spent buffered, not merely "failed".

**US-4 — Nothing changes for the listener.**
As a listener, playback is exactly as before: the first sound arrives no later, the page closes
without waiting, no visible element appears, and a blocked or broken collector changes nothing I
can perceive.

**US-5 — Privacy by construction.**
As a listener, I am not identified: nothing survives the page that could recognise me, no third
party sees this, and the record is discarded after 30 days. I can opt out with the browser's
privacy signal and the player still works.

**US-6 — Operate it without ceremony.**
As the maintainer, the collector is one more small part of the same service: it can fail, be
disabled, or be blocked by an ad-blocker without touching the player, and I can inspect the raw
records with a single command on the server.

## Data inventory

Captured (allow-list, nothing outside it):

- a session reference, random per page load, not stored in the browser, not stable across visits;
- platform family and browser family/version, derived from the user agent and truncated;
- the station tuned (as configured in the player), and the transition to each station;
- the ordered playback phases with the time spent in each: `подключение`, `эфир`,
  `переподключение`, `нет сигнала`, `нажмите ▶`, idle;
- per attempt: how long it took, whether it was a retry, how many retries had already failed;
- the failure reason the platform exposes, if any: refused playback, media error, transport error,
  stall duration, mixed-content block;
- whether sound was ever produced, and the time from tap to first sound;
- foreground/background transitions and connection class changes (coarse, as the browser reports
  them), because a phone losing the screen is a normal cause of a stall;
- total time in `эфир`, total session length.

Not captured:

- any persistent identifier: no cookie, no stored id, no fingerprint, no advertising id;
- IP address, stored or derived; no country, no city, no coordinates;
- anything the listener types; there is no input in the product;
- page views, clicks, scroll, hover, or time spent outside playback;
- free-form strings from the client: every field is a small enumerated or numeric value, except the
  station identity and a truncated user-agent.

Honest limitation, stated rather than hidden: the record necessarily shows which station played and
when the session happened. That is accepted because it is first-party, retained for 30 days, never
joined to an identity, and never shared.

## Success criteria

| ID | Criterion |
|---|---|
| SC-001 | Any session that produced a tap on play or a station can be reconstructed: platform, station, ordered phases with durations, terminal phase, first-sound time. |
| SC-002 | A session that ends in `нажмите ▶` with a buffered stream is reported as that specific outcome (not as a generic failure), including the buffered duration. |
| SC-003 | A station returning an error is distinguishable from a refused `play()` and from a stall, by the failure reason recorded. |
| SC-004 | Per 24 hours, sessions reaching `эфир` and sessions failing can be counted per station and per platform. |
| SC-005 | Volume: no more than one record per 30 s of playback, at most 12 per 10-minute session, at most 8 KB per session. |
| SC-006 | Playback is unaffected: with the collector blocked, returning errors, or answering 5 s late, all seven player matrix scenarios behave exactly as they do today, with no console noise and no retry storm. |
| SC-007 | Nothing is sent before the listener's first action: page load issues no additional request. |
| SC-008 | Bounded loss: if the page is closed or backgrounded abruptly, the record up to the last second is still delivered. |
| SC-009 | Ordering and deduplication: records arrive in a defined order, and a repeated delivery is stored once. |
| SC-010 | Retention: records older than 30 days are unreadable and physically removed, verified by a test that ages a record. |
| SC-011 | Privacy: the payload contains no field outside the allow-list; a test fails if a new field appears without updating this document. |
| SC-012 | Opt-out: with the browser's Global Privacy Control (or Do Not Track) signal set, the player sends nothing and plays identically. |
| SC-013 | Time to diagnosis: from "it doesn't work on my phone" to a full phase history in under 5 minutes of maintainer work. |
| SC-014 | Abusive volume: a client that floods the collector cannot exhaust server resources; legitimate records are not lost as a result. |

## Edge cases

| ID | Case | Required behaviour |
|---|---|---|
| EC-1 | Listener opens the page and never presses play | No record, no request. |
| EC-2 | App is backgrounded and the OS suspends audio | The suspension is recorded as a phase transition, and the session does not look like a fresh one on return. |
| EC-3 | Page is closed from the app switcher | Pending records are delivered without delaying the close; loss bounded to the last second. |
| EC-4 | Collector is down, slow, or answers 500 | Records are dropped after a short bounded wait; the player is unaffected; no retry storm; no console output. |
| EC-5 | Ad-blocker or DNS filter blocks the collector | Silent drop; the player behaves normally. |
| EC-6 | Device clock is wrong or changes mid-session | Ordering uses a client sequence plus server receipt time; durations are computed from monotonic offsets, never from wall-clock differences. |
| EC-7 | Network flaps, the player retries every few seconds for minutes | Identical consecutive failures within 5 s are coalesced; the 12-record budget still holds. |
| EC-8 | Session runs for hours with the screen off | Transitions only, plus a periodic summary, within the record budget. |
| EC-9 | Two tabs open at once | Two independent sessions; no cross-contamination; each respects the budget. |
| EC-10 | Browser storage is disabled or private mode hides it | Session identity lives only in memory; playback and telemetry both keep working. |
| EC-11 | Malformed, oversized, or unknown-field payload | Rejected as a whole; nothing partially stored; no crash. |
| EC-12 | Station URL is mixed content (http on an https page) | Recorded as that specific failure reason. |
| EC-13 | Session id is invented or replayed by a third party | Worst case is a bogus record; no other record is affected, nothing is deleted or overwritten. |
| EC-14 | User agent is missing, enormous, or spoofed | Truncated and classified as "unknown"; still a valid record. |

## Constraints from the constitution

- **I** — telemetry uses the player's own phase vocabulary; it may not invent a parallel state model.
- **IV** — no request before the first tap; the page payload budget is unchanged; the collector must
  not sit in the audio path (**VI**).
- **V** — verification happens in WebKit with iPhone emulation, muted, and must include the
  collector-blocked variant.
- **IX** — no new visible UI, no change to the live region.
- **VII** — the feature ships through CI; the collector must not require manual steps on the VPS.

## Out of scope

- Dashboards, charts, any web UI over the collected data. Reading records is a command on the server.
- Third-party analytics, tag managers, session replay, heatmaps.
- Accounts, cross-device identity, per-user history as a product feature.
- JavaScript exception reporting and general application monitoring, beyond what surfaces as a
  playback phase outcome.
- Alerting, paging, anomaly detection, experiments and A/B tests.
- Consent banner. Not needed while the allow-list holds and no identity is created; if either
  changes, this feature is re-specified first.
- Historical backfill: nothing is collected before this ships.

## Open questions (for `/speckit-clarify`)

| ID | Question | Default if unanswered |
|---|---|---|
| Q-1 | Is 30-day retention right, or should it be shorter (7 days) for a single-user product? | 30 days, as specified |
| Q-2 | Honour Global Privacy Control only, or also Do Not Track? | Both, as specified in SC-012 |
| Q-3 | Is storing the exact station identity acceptable, or should it be a per-deployment opaque token? | Exact identity; it is first-party and short-lived |
| Q-4 | Is this one feature, or should "collect" and "read the records" be split? | One feature; reading is a command, not a product |
