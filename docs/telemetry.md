# Telemetry: reading a real session

The player records its own playback phases so that "не играет на айфоне" can be reconstructed
instead of guessed at. This page is the operator's view: what is stored, how to find one session,
and what the output means.

Feature spec, plan and quality gate: `.speckit/features/001-telemetry/`.

## What is stored

One JSON line per record, one file per UTC day, in `TELEMETRY_DIR` (default `./telemetry`):

```
2026-11-05.jsonl
```

Each line carries the player's phase or attempt plus what only the server knows: `build` (hash of the
served `app.js`), `received_at`, and `platform`/`browser`/`browser_ver` derived from the request's
user agent. **The raw user agent is never stored or logged.**

Not stored, by design: any persistent identifier, IP address, page views, clicks, or free-form
strings from the client. Records are deleted after 30 days (`TELEMETRY_RETENTION_DAYS`), with a
50 MB hard cap (`TELEMETRY_MAX_MB`) as a backstop.

Browsers that send Global Privacy Control or Do Not Track send nothing at all. Firefox enables GPC by
default, so **the absence of Firefox sessions is the opt-out working, not a bug**.

## Finding a session

You need two facts from the report: roughly when, and the platform.

```bash
# Everything in the last 24 hours, failures first
boxradio -telemetry-dump -since 24h

# A ±15 minute window around the report
boxradio -telemetry-dump -from 2026-11-05T10:10:00Z -to 2026-11-05T10:25:00Z

# Only this platform, only sessions that never played
boxradio -telemetry-dump -platform ios -failed -since 2h

# Counts per station and platform: live vs failed
boxradio -telemetry-dump -count -since 24h

# Raw records, for jq
boxradio -telemetry-dump -since 1h -json | jq -r 'select(.kind=="attempt")'
```

`-since`, `-from` and `-to` accept a duration (`24h`, `90m`) meaning "ago", or RFC3339. The dump is
one binary, one command; there is no dashboard and none is planned.

## Reading the output

```
bf6b187c1ee27141  ios/safari 26  build 72cafe166aa2  2026-11-05 07:42:32  "FIP"
  outcome: нажмите ▶ (buffered 2533 ms), never played
    +0        start    station FIP
    +0        phase    idle → подключение
    +2533     phase    подключение → нажмите ▶ (2533 ms) attempt 1
```

The four shapes that matter:

| Outcome | What it means | What to do |
|---|---|---|
| `эфир` | Sound was heard. | Nothing — this is the baseline. |
| `нажмите ▶` with `buffered … ms` | Data arrived, playback never started. The iOS state: the browser wanted a gesture, or refused after a source change. | Not a dead station. Look at the client, not the stream. |
| `нет сигнала`, reason `transport-error` / `media-error` | The stream could not be fetched or decoded. | Check the station from that platform; compare with other platforms. |
| `нет сигнала` across every station on one platform | The client or its network, not the stations. | This is exactly the case that needs the platform split in `-count`. |

`-count` answers "dead station or broken client" in one line:

```
station                          platform     live failed
FIP                              ios             2      4
FIP                              android         4      0
```

## Deploying the collector

The static service stays static; telemetry is a second process from the same binary.

```bash
# once, on the VPS (creates the unit, the directory, the nginx route, the sudoers entry)
bash deploy/remote-setup.sh
```

After that, CI restarts both units on every push to `main`. Manual operations:

```bash
sudo systemctl status  boxradio-telemetry
sudo systemctl restart boxradio-telemetry
sudo journalctl -u boxradio-telemetry -n 50
```

Configuration lives in the unit's environment (or `TELEMETRY_*` in the service env file):

| Variable | Default | Meaning |
|---|---|---|
| `TELEMETRY_ADDR` | `127.0.0.1:8081` | listen address; keep it on loopback |
| `TELEMETRY_DIR` | `telemetry` | where day files live |
| `TELEMETRY_RETENTION_DAYS` | `30` | age at which files are removed |
| `TELEMETRY_MAX_MB` | `50` | hard cap; oldest files are evicted first |

**Rollback:** `sudo systemctl stop boxradio-telemetry`. The player keeps working exactly as before —
it never waits for, or depends on, the collector.

## If a deploy breaks the collector

The player is unaffected: the client sends with `fetch(keepalive)` and falls back to silence. While
the collector is down, sessions are simply not recorded. Check that the route exists:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: text/plain' \
  --data '[{"v":1,"sid":"0123456789abcdef","seq":1,"kind":"start","station":"check"}]' \
  https://<domain>/api/telemetry   # expect 204
```
