package main

// Playback telemetry: collection, storage and reading.
//
// This is the write path of a feature whose whole point is evidence: when a
// listener says "the radio doesn't work on my phone", the player's own phases
// must be reconstructable afterwards. It deliberately stores as little as it
// can — see .speckit/features/001-telemetry/specify.md for the allow-list.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

const (
	recordVersion = 1

	maxBodyBytes      = 8 << 10 // request body hard cap
	maxBatch          = 8       // records per request
	maxSessionRecords = 12      // records per session (spec SC-005)
	maxSessionBytes   = 8 << 10 // per-session payload budget

	maxSessionsTracked = 10000
	sessionTTL         = 2 * time.Hour

	ratePerMinute = 60
	rateBurst     = 60
	rateTTL       = 10 * time.Minute
	maxRateKeys   = 10000
)

// ── record model ─────────────────────────────────────────────────────────────

// record is what the player sends. Anything outside these fields is rejected,
// so the allow-list in the spec is enforced by the decoder itself.
type record struct {
	V          int    `json:"v"`
	Sid        string `json:"sid"`
	Seq        int    `json:"seq"`
	T          int64  `json:"t"`
	Kind       string `json:"kind"`
	From       string `json:"from,omitempty"`
	To         string `json:"to,omitempty"`
	Ms         int64  `json:"ms,omitempty"`
	Attempt    int    `json:"attempt,omitempty"`
	Reason     string `json:"reason,omitempty"`
	BufferedMs int64  `json:"bufferedMs,omitempty"`
	Station    string `json:"station,omitempty"`
}

// storedRecord is a validated record plus what only the server knows: the build
// being served, the receipt time, and the platform derived from the request.
type storedRecord struct {
	record
	Build      string `json:"build"`
	ReceivedAt int64  `json:"received_at"`
	Platform   string `json:"platform"`
	Browser    string `json:"browser"`
	BrowserVer string `json:"browser_ver"`
}

var (
	validKinds = map[string]bool{
		"start": true, "phase": true, "attempt": true, "end": true, "budget-exhausted": true,
	}
	validPhases = map[string]bool{
		"idle": true, "connecting": true, "live": true, "retry": true, "failed": true, "blocked": true,
	}
	validReasons = map[string]bool{
		"none": true, "play-refused": true, "media-error": true,
		"transport-error": true, "stall": true, "mixed-content": true,
	}
)

func isHex64(s string) bool {
	if len(s) != 16 {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// validateRecord rejects anything the player has no business sending. It is
// deliberately strict: a record is either wholly understood or dropped.
func validateRecord(r record) error {
	if r.V != recordVersion {
		return fmt.Errorf("version %d", r.V)
	}
	if !isHex64(r.Sid) {
		return errors.New("bad sid")
	}
	if r.Seq < 1 || r.Seq > 1_000_000 {
		return errors.New("bad seq")
	}
	if r.T < 0 || r.T > 24*3600*1000 {
		return errors.New("bad t")
	}
	if !validKinds[r.Kind] {
		return fmt.Errorf("bad kind %q", r.Kind)
	}
	if r.From != "" && !validPhases[r.From] {
		return fmt.Errorf("bad from %q", r.From)
	}
	if r.To != "" && !validPhases[r.To] {
		return fmt.Errorf("bad to %q", r.To)
	}
	if r.Reason != "" && !validReasons[r.Reason] {
		return fmt.Errorf("bad reason %q", r.Reason)
	}
	if r.Ms < 0 || r.Ms > 24*3600*1000 || r.BufferedMs < 0 || r.BufferedMs > 24*3600*1000 {
		return errors.New("bad duration")
	}
	if len(r.Station) > 200 {
		return errors.New("station too long")
	}
	if r.Kind == "start" && r.Station == "" {
		return errors.New("start without station")
	}
	if r.Kind == "phase" && r.To == "" {
		return errors.New("phase without to")
	}
	return nil
}

// ── client derivation ────────────────────────────────────────────────────────

// deriveClient classifies a user agent. The raw string is never stored or
// logged: only these three short values are.
func deriveClient(ua string) (platform, browser, version string) {
	platform, browser, version = "unknown", "unknown", ""
	if ua == "" {
		return
	}
	lower := strings.ToLower(ua)

	switch {
	case strings.Contains(lower, "iphone"), strings.Contains(lower, "ipad"),
		strings.Contains(lower, "ipod"):
		platform = "ios"
	case strings.Contains(lower, "android"):
		platform = "android"
	case strings.Contains(lower, "windows"), strings.Contains(lower, "macintosh"),
		strings.Contains(lower, "x11"), strings.Contains(lower, "linux"):
		platform = "desktop"
	}

	switch {
	case strings.Contains(lower, "crios"), strings.Contains(lower, "chrome/"):
		browser = "chrome"
		version = afterToken(ua, "Chrome/")
	case strings.Contains(lower, "fxios"), strings.Contains(lower, "firefox/"):
		browser = "firefox"
		version = afterToken(ua, "Firefox/")
	case strings.Contains(lower, "safari"), strings.Contains(lower, "version/"):
		browser = "safari"
		version = afterToken(ua, "Version/")
	default:
		browser = "other"
	}

	if i := strings.IndexByte(version, '.'); i > 0 {
		version = version[:i]
	}
	if len(version) > 4 {
		version = version[:4]
	}
	return platform, browser, version
}

func afterToken(s, token string) string {
	i := strings.Index(s, token)
	if i < 0 {
		return ""
	}
	rest := s[i+len(token):]
	end := len(rest)
	for j, c := range rest {
		if !(c >= '0' && c <= '9') && c != '.' {
			end = j
			break
		}
	}
	return rest[:end]
}

// ── build stamp ──────────────────────────────────────────────────────────────

// buildStamp hashes the player being served, cached by modification time. It is
// what tells a report after a fix apart from one before it. A cached older
// player is stamped with the current build; received_at bounds that error.
type buildStamp struct {
	path  string
	mu    sync.Mutex
	mtime time.Time
	size  int64
	value string
}

func newBuildStamp(path string) *buildStamp {
	return &buildStamp{path: path}
}

func (b *buildStamp) get() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	fi, err := os.Stat(b.path)
	if err != nil {
		return "unknown"
	}
	if fi.ModTime().Equal(b.mtime) && fi.Size() == b.size && b.value != "" {
		return b.value
	}
	data, err := os.ReadFile(b.path)
	if err != nil {
		return "unknown"
	}
	sum := sha256.Sum256(data)
	b.mtime, b.size = fi.ModTime(), fi.Size()
	b.value = hex.EncodeToString(sum[:])[:12]
	return b.value
}

// ── store ────────────────────────────────────────────────────────────────────

type store struct {
	dir       string
	retention time.Duration
	maxBytes  int64
	mu        sync.Mutex
}

func newStore(dir string, retention time.Duration, maxBytes int64) (*store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &store{dir: dir, retention: retention, maxBytes: maxBytes}, nil
}

func (s *store) dayPath(t time.Time) string {
	return filepath.Join(s.dir, t.UTC().Format("2006-01-02")+".jsonl")
}

func (s *store) append(rec storedRecord) error {
	line, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	line = append(line, '\n')

	s.mu.Lock()
	defer s.mu.Unlock()

	f, err := os.OpenFile(s.dayPath(time.UnixMilli(rec.ReceivedAt)),
		os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	_, err = f.Write(line)
	return err
}

type dayFile struct {
	path string
	day  time.Time
	size int64
}

func (s *store) files() ([]dayFile, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	out := make([]dayFile, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		day, err := time.Parse("2006-01-02", strings.TrimSuffix(e.Name(), ".jsonl"))
		if err != nil {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, dayFile{path: filepath.Join(s.dir, e.Name()), day: day, size: fi.Size()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].day.Before(out[j].day) })
	return out, nil
}

// prune deletes files older than the retention window and then, as a backstop
// against a disk filling up, the oldest files until the directory fits.
func (s *store) prune(now time.Time) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	files, err := s.files()
	if err != nil {
		return 0, err
	}
	cutoff := now.UTC().Add(-s.retention)
	removed := 0

	kept := files[:0]
	for _, f := range files {
		// A day file is older than the window once its last moment is.
		if f.day.Add(24 * time.Hour).Before(cutoff) {
			if err := os.Remove(f.path); err != nil && !os.IsNotExist(err) {
				return removed, err
			}
			removed++
			continue
		}
		kept = append(kept, f)
	}

	var total int64
	for _, f := range kept {
		total += f.size
	}
	for _, f := range kept {
		if total <= s.maxBytes {
			break
		}
		if err := os.Remove(f.path); err != nil && !os.IsNotExist(err) {
			return removed, err
		}
		total -= f.size
		removed++
	}
	return removed, nil
}

// read returns records with from <= received_at <= to, in file order.
func (s *store) read(from, to time.Time, out io.Writer) error {
	s.mu.Lock()
	files, err := s.files()
	s.mu.Unlock()
	if err != nil {
		return err
	}

	for _, f := range files {
		// Day files are named by UTC day; widen by a day on each side so a
		// timezone edge cannot hide a record.
		if f.day.Add(48*time.Hour).Before(from) || f.day.After(to.Add(24*time.Hour)) {
			continue
		}
		if err := scanFile(f.path, from, to, out); err != nil {
			return err
		}
	}
	return nil
}

func scanFile(path string, from, to time.Time, out io.Writer) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	dec := json.NewDecoder(f)
	for {
		var rec storedRecord
		if err := dec.Decode(&rec); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			// A torn last line is expected after a crash; skip it.
			return nil
		}
		at := time.UnixMilli(rec.ReceivedAt)
		if at.Before(from) || at.After(to) {
			continue
		}
		line, err := json.Marshal(rec)
		if err != nil {
			continue
		}
		if _, err := out.Write(append(line, '\n')); err != nil {
			return err
		}
	}
}

// ── session budget & dedupe ──────────────────────────────────────────────────

type sessionState struct {
	seqs map[int]struct{}
	n    int
	last time.Time
}

// sessionBudget keeps per-session counts and seen sequence numbers so that a
// retried delivery is stored once and a client cannot exceed its budget.
type sessionBudget struct {
	mu  sync.Mutex
	m   map[string]*sessionState
	now func() time.Time
}

func newSessionBudget(now func() time.Time) *sessionBudget {
	return &sessionBudget{m: make(map[string]*sessionState), now: now}
}

func (b *sessionBudget) accept(sid string, seq int) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := b.now()
	s := b.m[sid]
	if s == nil {
		if len(b.m) >= maxSessionsTracked {
			b.sweepLocked(now)
		}
		s = &sessionState{seqs: make(map[int]struct{}, 4)}
		b.m[sid] = s
	}
	if _, dup := s.seqs[seq]; dup {
		return false
	}
	if s.n >= maxSessionRecords {
		return false
	}
	s.seqs[seq] = struct{}{}
	s.n++
	s.last = now
	return true
}

func (b *sessionBudget) sweepLocked(now time.Time) {
	for sid, s := range b.m {
		if now.Sub(s.last) > sessionTTL {
			delete(b.m, sid)
		}
	}
	if len(b.m) >= maxSessionsTracked {
		for sid := range b.m {
			delete(b.m, sid)
			if len(b.m) < maxSessionsTracked/2 {
				break
			}
		}
	}
}

// ── rate limit ───────────────────────────────────────────────────────────────

type bucket struct {
	tokens float64
	last   time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	m       map[string]*bucket
	now     func() time.Time
	perMin  float64
	burst   float64
	ttl     time.Duration
	maxKeys int
}

func newRateLimiter(now func() time.Time) *rateLimiter {
	return &rateLimiter{
		m: make(map[string]*bucket), now: now,
		perMin: ratePerMinute, burst: rateBurst, ttl: rateTTL, maxKeys: maxRateKeys,
	}
}

func (l *rateLimiter) allow(addr string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	b := l.m[addr]
	if b == nil {
		if len(l.m) >= l.maxKeys {
			l.sweepLocked(now)
		}
		b = &bucket{tokens: l.burst, last: now}
		l.m[addr] = b
	}
	b.tokens += now.Sub(b.last).Minutes() * l.perMin
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (l *rateLimiter) sweepLocked(now time.Time) {
	for addr, b := range l.m {
		if now.Sub(b.last) > l.ttl {
			delete(l.m, addr)
		}
	}
}

func clientAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ── collector ────────────────────────────────────────────────────────────────

type collector struct {
	st     *store
	build  *buildStamp
	budget *sessionBudget
	rate   *rateLimiter
	now    func() time.Time
	log    *zap.Logger
}

func newCollector(st *store, build *buildStamp, now func() time.Time, log *zap.Logger) *collector {
	return &collector{
		st: st, build: build, budget: newSessionBudget(now),
		rate: newRateLimiter(now), now: now, log: log,
	}
}

func (c *collector) mux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/telemetry", c.handleTelemetry)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})
	return mux
}

// handleTelemetry accepts a batch and answers 204 no matter what, so a client
// cannot probe what was stored. Invalid input is dropped whole, never partially.
func (c *collector) handleTelemetry(w http.ResponseWriter, r *http.Request) {
	defer func() {
		w.WriteHeader(http.StatusNoContent)
	}()

	if !c.rate.allow(clientAddr(r)) {
		return
	}

	body := http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var batch []record
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&batch); err != nil {
		return
	}
	// Trailing junk after the array is a malformed payload.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return
	}
	if len(batch) == 0 || len(batch) > maxBatch {
		return
	}

	now := c.now()
	platform, browser, version := deriveClient(r.UserAgent())
	build := c.build.get()

	for _, rec := range batch {
		if err := validateRecord(rec); err != nil {
			return
		}
		if !c.budget.accept(rec.Sid, rec.Seq) {
			continue
		}
		if err := c.st.append(storedRecord{
			record: rec, Build: build, ReceivedAt: now.UnixMilli(),
			Platform: platform, Browser: browser, BrowserVer: version,
		}); err != nil {
			c.log.Warn("telemetry append failed", zap.Error(err))
			return
		}
	}
}

// ── reading ──────────────────────────────────────────────────────────────────

type dumpOptions struct {
	Since    string
	From     string
	To       string
	Platform string
	Station  string
	Failed   bool
	Count    bool
	JSON     bool
}

type sessionView struct {
	sid        string
	records    []storedRecord
	station    string
	platform   string
	browser    string
	browserVer string
	build      string
	reached    bool
	firstSound int64
	outcome    string
	buffered   int64
	first      int64
	last       int64
}

func parseWhen(s string, now time.Time) (time.Time, error) {
	if d, err := time.ParseDuration(s); err == nil {
		return now.Add(-d), nil
	}
	return time.Parse(time.RFC3339, s)
}

func runDump(st *store, o dumpOptions, out io.Writer, now time.Time) error {
	from := now.Add(-24 * time.Hour)
	to := now

	if o.Since != "" {
		t, err := parseWhen(o.Since, now)
		if err != nil {
			return fmt.Errorf("since: %w", err)
		}
		from = t
	}
	if o.From != "" {
		t, err := parseWhen(o.From, now)
		if err != nil {
			return fmt.Errorf("from: %w", err)
		}
		from = t
	}
	if o.To != "" {
		t, err := parseWhen(o.To, now)
		if err != nil {
			return fmt.Errorf("to: %w", err)
		}
		to = t
	}
	if to.Before(from) {
		return errors.New("to is before from")
	}

	var raw strings.Builder
	if err := st.read(from, to, &raw); err != nil {
		return err
	}

	records := decodeLines(raw.String())
	sessions := groupSessions(records, o)
	if o.Count {
		printCounts(out, sessions)
		return nil
	}
	if o.JSON {
		for _, s := range sessions {
			for _, rec := range s.records {
				line, err := json.Marshal(rec)
				if err != nil {
					continue
				}
				fmt.Fprintln(out, string(line))
			}
		}
		return nil
	}
	for _, s := range sessions {
		printSession(out, s)
	}
	if len(sessions) == 0 {
		fmt.Fprintln(out, "no sessions in range")
	}
	return nil
}

func decodeLines(body string) []storedRecord {
	var out []storedRecord
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var rec storedRecord
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue
		}
		out = append(out, rec)
	}
	return out
}

// groupSessions orders records by (received_at, seq), drops duplicate
// deliveries, applies the filters and returns sessions failures-first.
func groupSessions(records []storedRecord, o dumpOptions) []sessionView {
	sort.SliceStable(records, func(i, j int) bool {
		if records[i].ReceivedAt != records[j].ReceivedAt {
			return records[i].ReceivedAt < records[j].ReceivedAt
		}
		return records[i].Seq < records[j].Seq
	})

	byID := make(map[string]*sessionView)
	seen := make(map[string]struct{}, len(records))
	var order []string

	for _, rec := range records {
		key := rec.Sid + "/" + fmt.Sprint(rec.Seq)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}

		s := byID[rec.Sid]
		if s == nil {
			s = &sessionView{
				sid: rec.Sid, platform: rec.Platform, browser: rec.Browser,
				browserVer: rec.BrowserVer, build: rec.Build, first: rec.ReceivedAt,
			}
			byID[rec.Sid] = s
			order = append(order, rec.Sid)
		}
		s.records = append(s.records, rec)
		s.last = rec.ReceivedAt
		if rec.Kind == "start" {
			s.station = rec.Station
		}
		if rec.To == "live" {
			s.reached = true
			if s.firstSound == 0 {
				// T is the client's offset within the session; older records
				// without it fall back to the receipt time.
				s.firstSound = rec.T
				if s.firstSound == 0 {
					s.firstSound = rec.ReceivedAt - s.first
				}
			}
		}
		if rec.Kind == "phase" || rec.Kind == "end" {
			if rec.To != "" {
				s.outcome = rec.To
			}
		}
		if rec.BufferedMs > s.buffered {
			s.buffered = rec.BufferedMs
		}
	}

	out := make([]sessionView, 0, len(order))
	for _, sid := range order {
		s := byID[sid]
		if o.Platform != "" && s.platform != o.Platform {
			continue
		}
		if o.Station != "" && !strings.Contains(strings.ToLower(s.station), strings.ToLower(o.Station)) {
			continue
		}
		if o.Failed && s.reached {
			continue
		}
		out = append(out, *s)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].reached != out[j].reached {
			return !out[i].reached // failing sessions first
		}
		return out[i].first > out[j].first // newest first
	})
	return out
}

var phaseLabel = map[string]string{
	"idle": "", "connecting": "подключение", "live": "эфир",
	"retry": "переподключение", "failed": "нет сигнала", "blocked": "нажмите ▶",
}

func printSession(out io.Writer, s sessionView) {
	header := fmt.Sprintf("%s  %s/%s %s  build %s  %s",
		s.sid, s.platform, s.browser, s.browserVer, s.build,
		time.UnixMilli(s.first).UTC().Format("2006-01-02 15:04:05"))
	if s.station != "" {
		header += fmt.Sprintf("  %q", s.station)
	}
	fmt.Fprintln(out, header)

	outcome := phaseLabel[s.outcome]
	if outcome == "" {
		outcome = s.outcome
	}
	if outcome == "" {
		outcome = "unknown"
	}
	line := fmt.Sprintf("  outcome: %s", outcome)
	if s.buffered > 0 {
		line += fmt.Sprintf(" (buffered %d ms)", s.buffered)
	}
	if !s.reached {
		line += ", never played"
	} else {
		line += fmt.Sprintf(", first sound %d ms", s.firstSound)
	}
	fmt.Fprintln(out, line)

	for _, rec := range s.records {
		fmt.Fprintf(out, "    +%-8d %-8s %s\n", rec.ReceivedAt-s.first, rec.Kind, describe(rec))
	}
}

func describe(rec storedRecord) string {
	switch rec.Kind {
	case "phase":
		from := phaseLabel[rec.From]
		to := phaseLabel[rec.To]
		if from == "" {
			from = rec.From
		}
		if to == "" {
			to = rec.To
		}
		d := ""
		if from != "" {
			d = from + " → " + to
		} else {
			d = to
		}
		if rec.Ms > 0 {
			d += fmt.Sprintf(" (%d ms)", rec.Ms)
		}
		if rec.Attempt > 0 {
			d += fmt.Sprintf(" attempt %d", rec.Attempt)
		}
		return d
	case "attempt":
		d := fmt.Sprintf("attempt %d", rec.Attempt)
		if rec.Reason != "" && rec.Reason != "none" {
			d += " " + rec.Reason
		}
		if rec.Ms > 0 {
			d += fmt.Sprintf(" (%d ms)", rec.Ms)
		}
		return d
	case "start":
		return "station " + rec.Station
	case "budget-exhausted":
		return "record budget exhausted"
	default:
		return rec.To
	}
}

func printCounts(out io.Writer, sessions []sessionView) {
	type key struct{ station, platform string }
	type counts struct{ live, failed int }
	agg := make(map[key]*counts)
	for _, s := range sessions {
		k := key{s.station, s.platform}
		if agg[k] == nil {
			agg[k] = &counts{}
		}
		if s.reached {
			agg[k].live++
		} else {
			agg[k].failed++
		}
	}

	type row struct {
		key
		counts
	}
	rows := make([]row, 0, len(agg))
	for k, v := range agg {
		rows = append(rows, row{k, *v})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].failed != rows[j].failed {
			return rows[i].failed > rows[j].failed
		}
		return rows[i].station < rows[j].station
	})

	fmt.Fprintf(out, "%-32s %-10s %6s %6s\n", "station", "platform", "live", "failed")
	for _, r := range rows {
		fmt.Fprintf(out, "%-32s %-10s %6d %6d\n", r.station, r.platform, r.live, r.failed)
	}
}
