# Box Radio — Constitution

Governing principles for spec-driven development in this repository.

**Version:** 1.0.0 · **Ratified:** 2026-11-04 · **Status:** active

Every `/speckit-specify`, `/speckit-plan`, `/speckit-tasks` and `/speckit-implement` artifact must
comply. A plan that cannot comply states which amendment it needs — it does not quietly except
itself.

---

## I. The player never lies about what it is doing

The header text is a contract with the user, not decoration.

1. Every playback state maps to exactly one label: `подключение`, `эфир`, `переподключение`,
   `нет сигнала`, `нажмите ▶`, or empty when idle. No other strings, no synonyms.
2. No state may persist without a transition. A stream that answers with an HTTP error reaches
   `нет сигнала` within 8 s; one that never produces sound within 35 s (three 10 s connect
   timeouts plus backoff); buffered-but-silent audio becomes `нажмите ▶` within 5 s.
3. The play button reflects user intent. Any state that stops sound must re-arm the button, so the
   user always has an action that works.
4. `error`, `pause` and silence are all failure signals. Silence is authoritative — an element that
   reports `readyState >= HAVE_FUTURE_DATA` but produces no sound for 2.5 s is a failure, whatever
   the element claims.

**Why:** the 2026-11 iOS regression — a full buffer, no sound, no `error`, and "переподключение"
forever with a pause icon on screen.

## II. Mobile Safari is the reference client

1. Any change touching playback in `app.js` is verified in WebKit with iPhone emulation before
   merge, across this matrix: normal start, dead station (404), mid-stream stall + recovery,
   refused `play()` (`NotAllowedError`), buffered-but-paused, pause/resume, station switch.
2. Touch targets are ≥ 44×44 px; no hover-only affordance; no horizontal scroll at 320 px width.
3. Browser workarounds carry a comment naming the browser and the failure mode they avoid
   (e.g. "no `load()` on a source-less element — leaves iOS Safari paused and unplayable").

## III. Zero-build frontend

1. `index.html`, `style.css` and `app.js` ship exactly as authored. No bundler, transpiler, CSS
   preprocessor, framework, or runtime dependency.
2. No third-party JavaScript, fonts or stylesheets from a CDN; system font stacks only.
3. Adding a build step or a runtime dependency is a constitutional amendment (see Governance), not
   a plan decision.

## IV. Small and fast

1. Total page payload (index.html + style.css + app.js) stays **≤ 45 KB uncompressed**. Baseline at
   ratification: 28.3 KB.
2. Page load issues no requests beyond those three assets (plus the favicon).
3. Audio starts within 3 s of the user's tap on a 4G profile, and the first dial never waits on a
   resource that is not the station stream.
4. The Go server stays a static file server plus `/healthz`: no stream proxying, transcoding, or
   per-request computation.

## V. Tested where it can break

1. `go test ./...` passes; no change merges with a red test.
2. Coverage ratchets: statement coverage never falls below the committed baseline (22.2% at
   ratification). New server code ships with table-driven tests in `main_test.go`.
3. Browser-level behaviour is covered by the scenario matrix in §II, run against a controllable
   stream — not by hand-clicking the live site.
4. **Automated browser tests run muted** (`--mute-audio`, and `muted` on every media element).
   Test audio must never reach the developer's output device.

## VI. Streams are curated, not proxied

1. Every station URL is `https://`. A mixed-content stream is a defect, not an inconvenience.
2. Audio is fetched by the browser directly from the station; the server never sits in the audio
   path.
3. A station is added only after it answers `200` with an `audio/*` content type within 5 s under a
   mobile Safari user agent. Stations that stop answering are removed, not left retrying.
4. Station URLs are stable identifiers: favourites are persisted by URL, so changing one silently
   drops users' saved stations.

## VII. Deploy only through CI, verifiably

1. `main` deploys via GitHub Actions on push. No manual edits to files on the VPS.
2. A deploy is complete only when the served `app.js` is byte-identical to the committed one
   (`git hash-object app.js` equals the hash of `GET /app.js`).
3. Secrets live in GitHub Actions secrets and the VPS environment. `.env` never enters git, and no
   credential reaches the frontend.

## VIII. Language and naming

1. UI copy is Russian; code identifiers, comments, commit messages and project docs are English.
2. Commits: `type(scope): imperative summary` — `fix(player):`, `feat(ui):`, `deploy:`.
3. Comments explain *why* (especially browser workarounds); no commented-out code.

## IX. Accessibility baseline

1. The status line is an `aria-live="polite"` region, so state changes are announced.
2. All controls are real `<button>` elements, keyboard reachable, with accessible names.
3. Focus is visible; `:focus-visible` is never suppressed.
4. New UI text meets WCAG AA (4.5:1 body, 3:1 large). Known debt at ratification: `--muted`
   (#555 on #101010) meta text is below AA — raise it when that text is next touched.

## X. Governance

1. Amendments are commits that modify this file, bump the version (MAJOR: principle removed or
   redefined; MINOR: principle added; PATCH: wording only), and state a one-line rationale.
2. Every `plan.md` contains a **Constitution check** section naming the principles it satisfies, or
   the amendment it requires.
3. Conflicts resolve in favour of this document. A violation is fixed or amended — never waived in
   a PR description.
4. `/speckit-analyze` is the enforcement point: an artifact that contradicts a principle is a
   finding, not a style nit.

---

## Baseline at ratification (2026-11-04)

| Metric | Value |
|---|---|
| Payload (html+css+js) | 28.3 KB uncompressed |
| Go test coverage | 22.2% |
| Reference clients | iOS Safari (WebKit), Android Chrome (Chromium) |
| Deploy path | push to `main` → GitHub Actions → VPS |
| Player states | `подключение` · `эфир` · `переподключение` · `нет сигнала` · `нажмите ▶` |
