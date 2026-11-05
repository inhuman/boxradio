// boxradio — static server for the internet radio player frontend, plus a
// separate collector process for playback telemetry.
//
// Serves index.html, app.js and style.css; audio streams play directly from
// the public station URLs in the browser, so the server only ships assets.
//
// The static service does no per-request work (constitution §IV.4). Telemetry
// is a different process, started with -telemetry, and is read with
// -telemetry-dump. Same binary, different modes.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/inhuman/config"
	"go.uber.org/zap"
)

type Config struct {
	Addr      string `env:"ADDR" env-default:":8080"`
	StaticDir string `env:"STATIC_DIR" env-default:"."`

	TelemetryDir           string `env:"TELEMETRY_DIR" env-default:"telemetry"`
	TelemetryAddr          string `env:"TELEMETRY_ADDR" env-default:"127.0.0.1:8081"`
	TelemetryRetentionDays int    `env:"TELEMETRY_RETENTION_DAYS" env-default:"30"`
	TelemetryMaxMB         int    `env:"TELEMETRY_MAX_MB" env-default:"50"`
}

func (c Config) validate() error {
	if c.Addr == "" {
		return errors.New("ADDR must not be empty")
	}
	if c.TelemetryDir == "" {
		return errors.New("TELEMETRY_DIR must not be empty")
	}
	if c.TelemetryRetentionDays <= 0 {
		return errors.New("TELEMETRY_RETENTION_DAYS must be positive")
	}
	if c.TelemetryMaxMB <= 0 {
		return errors.New("TELEMETRY_MAX_MB must be positive")
	}
	return nil
}

func (c Config) retention() time.Duration {
	return time.Duration(c.TelemetryRetentionDays) * 24 * time.Hour
}

func (c Config) maxBytes() int64 {
	return int64(c.TelemetryMaxMB) << 20
}

func newMux(staticDir string) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})
	mux.Handle("/", http.FileServer(http.Dir(staticDir)))
	return mux
}

func main() {
	log, err := zap.NewProduction()
	if err != nil {
		panic(err)
	}
	defer func() { _ = log.Sync() }()

	var (
		telemetryMode = flag.Bool("telemetry", false, "run the telemetry collector instead of the static server")
		dumpMode      = flag.Bool("telemetry-dump", false, "print collected telemetry and exit")
		dump          dumpOptions
	)
	flag.StringVar(&dump.Since, "since", "", "dump: records newer than a duration, e.g. 24h")
	flag.StringVar(&dump.From, "from", "", "dump: start of the window (RFC3339 or duration ago)")
	flag.StringVar(&dump.To, "to", "", "dump: end of the window (RFC3339 or duration ago)")
	flag.StringVar(&dump.Platform, "platform", "", "dump: filter by platform family (ios, android, desktop)")
	flag.StringVar(&dump.Station, "station", "", "dump: filter by station name")
	flag.BoolVar(&dump.Failed, "failed", false, "dump: only sessions that never reached live")
	flag.BoolVar(&dump.Count, "count", false, "dump: count live vs failed per station and platform")
	flag.BoolVar(&dump.JSON, "json", false, "dump: print raw records as JSON lines")
	flag.Parse()

	var cfg Config
	if err := config.Load(&cfg, config.WithSearchInDotEnvFile()); err != nil {
		log.Fatal("load config", zap.Error(err))
	}
	if err := cfg.validate(); err != nil {
		log.Fatal("invalid config", zap.Error(err))
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	switch {
	case *dumpMode:
		if code := runDumpMode(cfg, dump, os.Stdout, log); code != 0 {
			os.Exit(code)
		}
	case *telemetryMode:
		if err := runTelemetry(ctx, cfg, log); err != nil {
			log.Fatal("telemetry", zap.Error(err))
		}
	default:
		if err := runServer(ctx, cfg.Addr, newMux(cfg.StaticDir), log); err != nil {
			log.Fatal("serve", zap.Error(err))
		}
	}
}

func runDumpMode(cfg Config, o dumpOptions, out io.Writer, log *zap.Logger) int {
	st, err := newStore(cfg.TelemetryDir, cfg.retention(), cfg.maxBytes())
	if err != nil {
		log.Error("open telemetry dir", zap.Error(err))
		return 1
	}
	if err := runDump(st, o, out, time.Now()); err != nil {
		fmt.Fprintln(os.Stderr, "dump:", err)
		return 1
	}
	return 0
}

func runTelemetry(ctx context.Context, cfg Config, log *zap.Logger) error {
	st, err := newStore(cfg.TelemetryDir, cfg.retention(), cfg.maxBytes())
	if err != nil {
		return err
	}
	c := newCollector(st, newBuildStamp(filepath.Join(cfg.StaticDir, "app.js")), time.Now, log)

	// Retention runs at start and once a day; a failure is logged, never fatal:
	// a collector that cannot prune must still collect.
	prune := func() {
		n, err := st.prune(time.Now())
		if err != nil {
			log.Warn("telemetry prune failed", zap.Error(err))
		}
		if n > 0 {
			log.Info("telemetry pruned", zap.Int("files", n))
		}
	}
	prune()
	go func() {
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				prune()
			}
		}
	}()

	log.Info("telemetry listening", zap.String("addr", cfg.TelemetryAddr), zap.String("dir", cfg.TelemetryDir))
	return runServer(ctx, cfg.TelemetryAddr, c.mux(), log)
}

func runServer(ctx context.Context, addr string, handler http.Handler, log *zap.Logger) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		log.Info("listening", zap.String("addr", addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}

	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
