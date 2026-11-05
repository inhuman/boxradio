package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
)

const testUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

func testSid(n byte) string { return fmt.Sprintf("%016x", n) }

func recordJSON(sid string, seq int, kind string, extra string) string {
	s := fmt.Sprintf(`{"v":1,"sid":%q,"seq":%d,"t":%d,"kind":%q`, sid, seq, seq*1000, kind)
	if extra != "" {
		s += "," + extra
	}
	return s + "}"
}

func newTestCollector(t *testing.T, now time.Time) (*collector, *store, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := newStore(dir, 30*24*time.Hour, 50<<20)
	if err != nil {
		t.Fatalf("newStore: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.js"), []byte("'use strict';"), 0o600); err != nil {
		t.Fatal(err)
	}
	c := newCollector(st, newBuildStamp(filepath.Join(dir, "app.js")),
		func() time.Time { return now }, zap.NewNop())
	return c, st, dir
}

func post(t *testing.T, c *collector, body, ua string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/telemetry", strings.NewReader(body))
	if ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	rec := httptest.NewRecorder()
	c.mux().ServeHTTP(rec, req)
	return rec.Code
}

func storedLines(t *testing.T, dir string) []storedRecord {
	t.Helper()
	var out []storedRecord
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			if line == "" {
				continue
			}
			var rec storedRecord
			if err := json.Unmarshal([]byte(line), &rec); err != nil {
				t.Fatalf("bad stored line %q: %v", line, err)
			}
			out = append(out, rec)
		}
	}
	return out
}

func TestValidateRecord(t *testing.T) {
	valid := []record{
		{V: 1, Sid: testSid(1), Seq: 1, T: 0, Kind: "start", Station: "FIP"},
		{V: 1, Sid: testSid(1), Seq: 2, T: 10, Kind: "phase", From: "idle", To: "connecting", Ms: 10},
		{V: 1, Sid: testSid(1), Seq: 3, T: 20, Kind: "attempt", Attempt: 1, Reason: "transport-error", Ms: 900},
		{V: 1, Sid: testSid(1), Seq: 4, T: 30, Kind: "phase", To: "blocked", BufferedMs: 2100},
		{V: 1, Sid: testSid(1), Seq: 5, T: 40, Kind: "budget-exhausted"},
	}
	for i, rec := range valid {
		if err := validateRecord(rec); err != nil {
			t.Errorf("valid[%d] rejected: %v", i, err)
		}
	}

	invalid := map[string]record{
		"version":               {V: 2, Sid: testSid(1), Seq: 1, Kind: "start", Station: "FIP"},
		"short sid":             {V: 1, Sid: "abc", Seq: 1, Kind: "start", Station: "FIP"},
		"non-hex sid":           {V: 1, Sid: strings.Repeat("z", 16), Seq: 1, Kind: "start", Station: "FIP"},
		"seq zero":              {V: 1, Sid: testSid(1), Seq: 0, Kind: "start", Station: "FIP"},
		"negative t":            {V: 1, Sid: testSid(1), Seq: 1, T: -1, Kind: "start", Station: "FIP"},
		"kind":                  {V: 1, Sid: testSid(1), Seq: 1, Kind: "telemetry"},
		"phase enum":            {V: 1, Sid: testSid(1), Seq: 1, Kind: "phase", To: "playing"},
		"reason enum":           {V: 1, Sid: testSid(1), Seq: 1, Kind: "attempt", Reason: "because"},
		"start without station": {V: 1, Sid: testSid(1), Seq: 1, Kind: "start"},
		"phase without to":      {V: 1, Sid: testSid(1), Seq: 1, Kind: "phase", From: "idle"},
		"station too long":      {V: 1, Sid: testSid(1), Seq: 1, Kind: "start", Station: strings.Repeat("x", 201)},
	}
	for name, rec := range invalid {
		if err := validateRecord(rec); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

func TestDeriveClient(t *testing.T) {
	tests := []struct {
		name                       string
		ua                         string
		platform, browser, version string
	}{
		{"iphone safari", testUA, "ios", "safari", "17"},
		{"ipad safari", "Mozilla/5.0 (iPad; CPU OS 16_0) Version/16.0 Safari/605.1.15", "ios", "safari", "16"},
		{"android chrome", "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/131.0.0.0 Mobile Safari/537.36", "android", "chrome", "131"},
		{"desktop firefox", "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "desktop", "firefox", "130"},
		{"empty", "", "unknown", "unknown", ""},
		{"garbage", "curl/8.5.0", "unknown", "other", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, b, v := deriveClient(tt.ua)
			if p != tt.platform || b != tt.browser || v != tt.version {
				t.Fatalf("got %s/%s/%s want %s/%s/%s", p, b, v, tt.platform, tt.browser, tt.version)
			}
		})
	}
}

func TestBuildStamp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app.js")
	if err := os.WriteFile(path, []byte("one"), 0o600); err != nil {
		t.Fatal(err)
	}
	bs := newBuildStamp(path)
	first := bs.get()
	if len(first) != 12 {
		t.Fatalf("stamp %q is not 12 chars", first)
	}
	if again := bs.get(); again != first {
		t.Fatalf("stamp not cached: %q then %q", first, again)
	}
	// A changed file must change the stamp (the cache is keyed by mtime+size).
	if err := os.WriteFile(path, []byte("two-two"), 0o600); err != nil {
		t.Fatal(err)
	}
	if second := bs.get(); second == first {
		t.Fatal("stamp did not change after the file changed")
	}
	if missing := newBuildStamp(filepath.Join(dir, "nope.js")).get(); missing != "unknown" {
		t.Fatalf("missing file stamp = %q", missing)
	}
}

func TestStoreAppendRead(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	c, st, dir := newTestCollector(t, now)

	body := "[" + recordJSON(testSid(1), 1, "start", `"station":"FIP"`) + "," +
		recordJSON(testSid(1), 2, "phase", `"from":"idle","to":"connecting","ms":10`) + "]"
	if code := post(t, c, body, testUA); code != http.StatusNoContent {
		t.Fatalf("code = %d", code)
	}

	got := storedLines(t, dir)
	if len(got) != 2 {
		t.Fatalf("stored %d records, want 2", len(got))
	}
	if got[0].Build == "" || got[0].Platform != "ios" || got[0].Browser != "safari" || got[0].BrowserVer != "17" {
		t.Fatalf("missing stamps: %+v", got[0])
	}
	if got[0].ReceivedAt != now.UnixMilli() {
		t.Fatalf("received_at = %d, want %d", got[0].ReceivedAt, now.UnixMilli())
	}
	if got[0].Station != "FIP" {
		t.Fatalf("station = %q", got[0].Station)
	}

	// The raw user agent must appear nowhere on disk.
	raw, err := os.ReadFile(filepath.Join(dir, now.Format("2006-01-02")+".jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "AppleWebKit") || strings.Contains(string(raw), "iPhone") {
		t.Fatal("raw user agent leaked into the day file")
	}

	var out strings.Builder
	if err := runDump(st, dumpOptions{}, &out, now); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "FIP") || !strings.Contains(out.String(), "подключение") {
		t.Fatalf("dump missing session: %s", out.String())
	}
}

func TestCollectorRejectsWholePayload(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	c, _, dir := newTestCollector(t, now)

	cases := map[string]string{
		"unknown field": "[" + recordJSON(testSid(1), 1, "start", `"station":"FIP","ip":"1.2.3.4"`) + "]",
		"not an array":  recordJSON(testSid(1), 1, "start", `"station":"FIP"`),
		"empty":         "[]",
		"too many":      "[" + strings.Join(manyRecords(9), ",") + "]",
		"bad json":      "[{",
	}
	for name, body := range cases {
		if code := post(t, c, body, testUA); code != http.StatusNoContent {
			t.Errorf("%s: code = %d, want 204", name, code)
		}
		if n := len(storedLines(t, dir)); n != 0 {
			t.Errorf("%s: stored %d records, want 0", name, n)
		}
	}

	oversize := "[" + recordJSON(testSid(1), 1, "start", `"station":"`+strings.Repeat("x", maxBodyBytes)+`"`) + "]"
	post(t, c, oversize, testUA)
	if n := len(storedLines(t, dir)); n != 0 {
		t.Fatalf("oversize payload stored %d records", n)
	}
}

func manyRecords(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = recordJSON(testSid(1), i+1, "phase", `"to":"connecting"`)
	}
	return out
}

func TestCollectorDedupesAndBudgets(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	c, _, dir := newTestCollector(t, now)

	one := "[" + recordJSON(testSid(2), 1, "start", `"station":"FIP"`) + "]"
	post(t, c, one, testUA)
	post(t, c, one, testUA) // a retried beacon
	if n := len(storedLines(t, dir)); n != 1 {
		t.Fatalf("duplicate stored: %d lines", n)
	}

	// Send more records than a session is allowed, a batch at a time.
	for seq := 2; seq <= maxSessionRecords+4; seq++ {
		post(t, c, "["+recordJSON(testSid(3), seq, "phase", `"to":"connecting"`)+"]", testUA)
	}
	var forSid3 int
	for _, rec := range storedLines(t, dir) {
		if rec.Sid == testSid(3) {
			forSid3++
		}
	}
	if forSid3 != maxSessionRecords {
		t.Fatalf("budget kept %d records, want %d", forSid3, maxSessionRecords)
	}
}

func TestRateLimiter(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	l := newRateLimiter(func() time.Time { return now })

	allowed := 0
	for i := 0; i < rateBurst+5; i++ {
		if l.allow("192.0.2.1") {
			allowed++
		}
	}
	if allowed != rateBurst {
		t.Fatalf("allowed %d, want %d", allowed, rateBurst)
	}
	// Another source is unaffected, and a minute refills the bucket.
	if !l.allow("192.0.2.2") {
		t.Fatal("second source was limited")
	}
	now = now.Add(time.Minute)
	if !l.allow("192.0.2.1") {
		t.Fatal("bucket did not refill")
	}
}

func TestPruneRetention(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	st, err := newStore(dir, 30*24*time.Hour, 1<<30)
	if err != nil {
		t.Fatal(err)
	}

	old := now.AddDate(0, 0, -40).Format("2006-01-02") + ".jsonl"
	kept := now.AddDate(0, 0, -10).Format("2006-01-02") + ".jsonl"
	for _, name := range []string{old, kept} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("{}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	removed, err := st.prune(now)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("removed %d, want 1", removed)
	}
	if _, err := os.Stat(filepath.Join(dir, old)); !os.IsNotExist(err) {
		t.Fatal("old file survived")
	}
	if _, err := os.Stat(filepath.Join(dir, kept)); err != nil {
		t.Fatal("recent file was removed")
	}
}

func TestPruneCap(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	st, err := newStore(dir, 30*24*time.Hour, 15) // 15 bytes: room for one 11-byte day file
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		name := now.AddDate(0, 0, -i).Format("2006-01-02") + ".jsonl"
		if err := os.WriteFile(filepath.Join(dir, name), []byte("0123456789\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.prune(now); err != nil {
		t.Fatal(err)
	}
	files, err := st.files()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatalf("kept %d files, want 1 (oldest evicted first)", len(files))
	}
	if got := files[0].day.Format("2006-01-02"); got != now.Format("2006-01-02") {
		t.Fatalf("kept %s, want today", got)
	}
}

func dumpFixture(t *testing.T, now time.Time) (*store, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := newStore(dir, 30*24*time.Hour, 1<<30)
	if err != nil {
		t.Fatal(err)
	}
	base := now.Add(-time.Hour).UnixMilli()
	recs := []storedRecord{
		// A session that played, then died.
		{record: record{V: 1, Sid: testSid(10), Seq: 1, T: 0, Kind: "start", Station: "FIP"},
			ReceivedAt: base, Platform: "ios", Browser: "safari", BrowserVer: "17", Build: "aaa"},
		{record: record{V: 1, Sid: testSid(10), Seq: 2, Kind: "phase", From: "idle", To: "connecting"},
			ReceivedAt: base + 10, Platform: "ios", Browser: "safari", BrowserVer: "17", Build: "aaa"},
		{record: record{V: 1, Sid: testSid(10), Seq: 3, Kind: "phase", From: "connecting", To: "live"},
			ReceivedAt: base + 800, Platform: "ios", Browser: "safari", BrowserVer: "17", Build: "aaa"},
		{record: record{V: 1, Sid: testSid(10), Seq: 4, Kind: "phase", From: "live", To: "retry"},
			ReceivedAt: base + 40000, Platform: "ios", Browser: "safari", BrowserVer: "17", Build: "aaa"},
		// A session that never played: buffered, then blocked.
		{record: record{V: 1, Sid: testSid(20), Seq: 1, T: 0, Kind: "start", Station: "WFMU"},
			ReceivedAt: base + 100, Platform: "android", Browser: "chrome", BrowserVer: "131", Build: "bbb"},
		{record: record{V: 1, Sid: testSid(20), Seq: 2, Kind: "phase", To: "connecting"},
			ReceivedAt: base + 110, Platform: "android", Browser: "chrome", BrowserVer: "131", Build: "bbb"},
		{record: record{V: 1, Sid: testSid(20), Seq: 3, Kind: "phase", To: "blocked", BufferedMs: 2100},
			ReceivedAt: base + 2600, Platform: "android", Browser: "chrome", BrowserVer: "131", Build: "bbb"},
		// A duplicate delivery of seq 3, which must be stored once.
		{record: record{V: 1, Sid: testSid(20), Seq: 3, Kind: "phase", To: "blocked", BufferedMs: 2100},
			ReceivedAt: base + 2700, Platform: "android", Browser: "chrome", BrowserVer: "131", Build: "bbb"},
	}
	for _, rec := range recs {
		if err := st.append(rec); err != nil {
			t.Fatal(err)
		}
	}
	return st, dir
}

func TestDumpOrderingAndFailuresFirst(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	st, _ := dumpFixture(t, now)

	var out strings.Builder
	if err := runDump(st, dumpOptions{}, &out, now); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	if strings.Index(s, "WFMU") > strings.Index(s, "FIP") {
		t.Fatalf("failing session is not first:\n%s", s)
	}
	if !strings.Contains(s, "buffered 2100 ms") {
		t.Fatalf("buffered duration missing:\n%s", s)
	}
	if !strings.Contains(s, "never played") {
		t.Fatalf("blocked session not marked:\n%s", s)
	}
	if !strings.Contains(s, "first sound 800 ms") {
		t.Fatalf("first-sound offset missing for the session that played:\n%s", s)
	}
}

func TestDumpFiltersAndCount(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	st, _ := dumpFixture(t, now)

	var ios strings.Builder
	if err := runDump(st, dumpOptions{Platform: "ios"}, &ios, now); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ios.String(), "WFMU") || !strings.Contains(ios.String(), "FIP") {
		t.Fatalf("platform filter wrong:\n%s", ios.String())
	}

	var failed strings.Builder
	if err := runDump(st, dumpOptions{Failed: true}, &failed, now); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(failed.String(), "WFMU") || strings.Contains(failed.String(), "FIP") {
		t.Fatalf("failed filter wrong:\n%s", failed.String())
	}

	var counts strings.Builder
	if err := runDump(st, dumpOptions{Count: true}, &counts, now); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(counts.String(), "FIP") || !strings.Contains(counts.String(), "WFMU") {
		t.Fatalf("counts missing stations:\n%s", counts.String())
	}
	if !strings.Contains(counts.String(), "1") {
		t.Fatalf("counts look empty:\n%s", counts.String())
	}

	// A window that excludes the sessions must not invent them.
	var none strings.Builder
	if err := runDump(st, dumpOptions{Since: "1m"}, &none, now); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(none.String(), "FIP") {
		t.Fatalf("window filter ignored:\n%s", none.String())
	}
}

func TestDumpWindowRejectsBackwardsRange(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	st, _ := dumpFixture(t, now)
	if err := runDump(st, dumpOptions{From: "1h", To: "2h"}, &strings.Builder{}, now); err == nil {
		t.Fatal("expected an error for to < from")
	}
}

func TestConfigValidation(t *testing.T) {
	good := Config{Addr: ":8080", StaticDir: ".", TelemetryDir: "t", TelemetryAddr: "127.0.0.1:8081",
		TelemetryRetentionDays: 30, TelemetryMaxMB: 50}
	if err := good.validate(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	bad := []Config{
		{TelemetryDir: "t", TelemetryRetentionDays: 30, TelemetryMaxMB: 50},
		{Addr: ":8080", TelemetryRetentionDays: 30, TelemetryMaxMB: 50},
		{Addr: ":8080", TelemetryDir: "t", TelemetryMaxMB: 50},
		{Addr: ":8080", TelemetryDir: "t", TelemetryRetentionDays: 30},
	}
	for i, c := range bad {
		if err := c.validate(); err == nil {
			t.Errorf("bad[%d] accepted", i)
		}
	}
}

// SC-014: a flood from one source is rate-limited and cannot damage or
// displace another session's records.
func TestFloodLeavesOtherSessionsIntact(t *testing.T) {
	now := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)
	c, _, dir := newTestCollector(t, now)

	legit := "[" + recordJSON(testSid(90), 1, "start", `"station":"FIP"`) + "," +
		recordJSON(testSid(90), 2, "phase", `"to":"connecting"`) + "]"
	post(t, c, legit, testUA)
	if n := len(storedLines(t, dir)); n != 2 {
		t.Fatalf("legit session stored %d records, want 2", n)
	}

	for i := 0; i < 500; i++ {
		sid := fmt.Sprintf("%016x", 4096+i)
		body := "[" + recordJSON(sid, 1, "start", `"station":"flood"`) + "]"
		post(t, c, body, testUA)
	}

	lines := storedLines(t, dir)
	var legitKept int
	for _, rec := range lines {
		if rec.Sid == testSid(90) {
			legitKept++
		}
	}
	if legitKept != 2 {
		t.Fatalf("legit records damaged by the flood: %d of 2 kept", legitKept)
	}
	// The limiter must bound how much a single source can write; the flood was
	// 500 requests, the bucket holds 60.
	if len(lines) > rateBurst+2 {
		t.Fatalf("flood stored %d records, want at most %d", len(lines), rateBurst+2)
	}
}
