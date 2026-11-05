# 001 — Quality checklist

A gate, not a plan. Every item is pass/fail with a mechanical check — if two people disagree on the
result, the item is written badly.

**Tags:** `pre` = runnable now, on the artifacts · `post` = runnable after implementation · `both`.

**How to run:** `pre` items before `/speckit-implement` (they catch spec defects while they are still
free to fix), everything else before merging `feat/telemetry` into `main`. Any **⛔** item failing
blocks the merge; the rest are fixed-or-recorded, and a recorded exception names its reason.

---

## A. Requirements (`pre`)

- [ ] Every user story has an acceptance line. Pass: `grep -c "^\*Acceptance:\*" specify.md` equals
      the number of `**US-` headers (6).
- [ ] Every success criterion is checkable. Pass: each `SC-` row either contains a number with a unit
      or names a binary behaviour with a test (no "fast", "quickly", "user-friendly", "as needed").
- [ ] No requirement contradicts another. Pass: retention (30 d) matches in US-5, SC-010 and D-1;
      opt-out (GPC + DNT) matches in SC-012 and D-3.
- [ ] Out-of-scope list covers what is *not* built. Pass: dashboards, third-party analytics,
      accounts, alerting, consent banner, backfill are all named.
- [ ] No implementation detail leaked into `specify.md`. Pass: no `net/http`, `JSONL`, `sendBeacon`,
      `sha256`, `SQLite`, `systemd` in the spec.

## B. Coverage (`pre`)

- [ ] Every SC has at least one task. Pass: 16/16 in the coverage table, zero unmapped.
- [ ] Every EC has a task. Pass: 16/16, zero unmapped.
- [ ] Every decision D-1…D-5 is traceable to a task. Pass: 5/5.
- [ ] Coverage is real, not nominal. Pass: for every task named in the coverage table, the task text
      itself describes the behaviour the criterion demands — spot-check EC-07 (coalescing) and
      SC-015 (time range), the two that were nominal before.
- [ ] Support tasks are declared, not hidden. Pass: the five tasks with no direct requirement are
      listed in their own section.

## C. Consistency (`pre`)

- [ ] Plan implements the spec and nothing more. Pass: no plan section builds an out-of-scope item.
- [ ] Plan does not contradict the constitution. Pass: each of §I–§IX has a Constitution-check row
      with a verdict, and every non-"OK" row names its amendment or its accepted interpretation.
- [ ] §IV.4 status is explicit. Pass: either the amendment exists with a version bump, or the
      interpretation ("static *process*", not "static *module*") is written in the plan and accepted
      by the owner in the thread. ⛔
- [ ] No dependency or build step was introduced. Pass: `git diff go.mod go.sum` is empty in the
      implementation PR and no `package.json`, bundler or minifier appears in CI. ⛔
- [ ] Task IDs referenced by the plan exist. Pass: every `T\d{3}` in `plan.md` is defined in
      `tasks.md`.
- [ ] Criterion IDs referenced by tasks exist. Pass: every `SC-\d{3}` / `EC-\d{2}` in `tasks.md`
      is defined in `specify.md`.

## D. Privacy and security (`post`)

- [ ] Payload carries only allow-listed fields. Pass: the harness assertion fails when an extra field
      is added. ⛔
- [ ] The raw user agent appears neither in the day file nor in the journal. Pass:
      `grep -F "<device UA>" telemetry/*.jsonl` and `journalctl -u boxradio-telemetry | grep -F`
      both return nothing. ⛔
- [ ] No persistent identifier: two consecutive page loads produce two different `sid`s, and nothing
      is written to storage on the client. Pass: devtools → Application → no new key after a session.
- [ ] GPC/DNT gate is total. Pass: with the signal set, a HAR shows zero `POST /api/telemetry`, and
      the player matrix is unchanged.
- [ ] No IP is persisted. Pass: no IPv4/IPv6 literal in any stored line, including the rate-limit
      path (in-memory only, 10-minute expiry).
- [ ] Malformed, oversized or unknown-field input is rejected whole. Pass: `curl` with 9 KB, with an
      extra field, and with a bad `sid` → `204`, and `wc -l` on the day file does not change.
- [ ] The endpoint cannot be used to delete or overwrite. Pass: repeated delivery of an existing
      `(sid, seq)` leaves exactly one line.

## E. Performance and budgets (`post`)

- [ ] Page payload ≤ 45 KB. Pass: `wc -c index.html style.css app.js` sums to ≤ 46080 (measured 34416). ⛔
- [ ] Page load issues no request beyond the four assets. Pass: HAR on a cold load shows only
      `index.html`, `style.css`, `app.js`, `favicon.svg`.
- [ ] Nothing is sent before the first playback action. Pass: open the page, wait 60 s, do nothing →
      HAR shows no `/api/telemetry`.
- [ ] Record budget holds. Pass: a simulated 10-minute session with a flapping stream yields ≤ 12
      records and ≤ 8 KB.
- [ ] First sound is not delayed. Pass: tap-to-first-sound within ±0 ms of the pre-telemetry build on
      the same harness.
- [ ] Collector work is bounded. Pass: p99 handler time under 5 ms on the VPS for a normal record, and
      the static server's numbers unchanged.

## F. Reliability and failure modes (`post`)

- [ ] Collector blocked → player identical. Pass: all seven matrix scenarios green with the endpoint
      blackholed; console clean. ⛔
- [ ] Collector 500 / 5 s late → player identical, no retry storm. Pass: same matrix; beacon count
      does not grow.
- [ ] Ad-blocked path is silent. Pass: no console output, no visible UI change.
- [ ] Abrupt close keeps the last second. Pass: close the tab from the app switcher mid-play → the
      day file contains phases up to within 1 s of the close.
- [ ] Buffered-but-silent is reported as its own outcome. Pass: the iOS-stuck simulation produces a
      `нажмите ▶` terminal outcome with a buffered duration, not "failed". ⛔
- [ ] Ordering is stable and dedupe survives retries. Pass: sort by `(received_at, seq)` reconstructs
      the timeline; a duplicate POST adds no line.
- [ ] Retention actually deletes. Pass: a file aged 31 days is absent after prune, and
      `-telemetry-dump -since 40d` returns nothing. ⛔
- [ ] Flood does not harm other sessions. Pass: 100× volume from one source; other sessions' records
      all present, memory bounded.

## G. Player and accessibility (`post`)

- [ ] No visible change. Pass: DOM diff against the previous build shows no new element; the status
      line is still the same `aria-live="polite"` node.
- [ ] The five phase labels are unchanged. Pass: `подключение`, `эфир`, `переподключение`,
      `нет сигнала`, `нажмите ▶`.
- [ ] Keyboard and touch unaffected. Pass: play/pause/prev/next still reachable and ≥ 44×44 px.
- [ ] Browser matrix was run **muted**. Pass: launch args contain `--mute-audio` and the init script
      sets `muted`; no sound reached the host. ⛔

## H. Operations and deploy (`post`)

- [ ] `boxradio-telemetry.service` exists and is enabled on the VPS. Pass: `systemctl is-enabled`.
- [ ] sudoers allows restarting the collector. Pass: `sudo -n systemctl restart boxradio-telemetry`
      exits 0.
- [ ] nginx routes only `/api/telemetry` to the collector. Pass: `curl /` still served by the static
      service; `curl -X POST /api/telemetry` reaches the collector; no other path is exposed.
- [ ] Deploy is verifiable. Pass: served `app.js` hash equals `git hash-object app.js`. ⛔
- [ ] A real session from a phone is visible within a minute. Pass: play on the device, then
      `-telemetry-dump -since 5m` shows it.
- [ ] Rollback is one command and leaves the player working. Pass: `systemctl stop boxradio-telemetry`
      → radio plays, no console noise.

## I. Tests and docs (`post`)

- [ ] `go test ./...` passes and coverage did not fall below 22.2%. ⛔
- [ ] New server code has table-driven tests (validation, derivation, append, prune, dump, rate limit).
- [ ] The payload allow-list test exists and fails on an added field.
- [ ] `docs/telemetry.md` explains lookup by time and platform, and what the output means.
- [ ] `docs/telemetry.md` covers the second unit, `TELEMETRY_DIR`, dump usage and retention.
- [ ] The commit trail is greppable: `fix(...)`, `docs(spec)`, one feature per branch.

---

## Stop-the-line (⛔) summary

Ten items block a merge on their own:

1. §IV.4 status is explicit — amendment or accepted interpretation.
2. No new dependency and no build step.
3. Payload carries allow-listed fields only.
4. The raw user agent is absent from both files and logs.
5. Page payload stays ≤ 45 KB.
6. The collector-blocked matrix is green.
7. Retention actually deletes.
8. Browser tests run muted.
9. The deploy hash is verified.
10. `go test ./...` is green.

Everything else is fixed or recorded with a reason.

## Reuse

This file is per-feature, but sections C, E, G and I are project-level and should be lifted into the
next feature's checklist nearly unchanged — they encode the constitution, not this feature.
