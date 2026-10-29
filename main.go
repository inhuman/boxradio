// boxradio — static server for the internet radio player frontend.
//
// Serves index.html, app.js and style.css; audio streams play directly from
// the public station URLs in the browser, so the server only ships assets.
package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/inhuman/config"
	"go.uber.org/zap"
)

type Config struct {
	Addr      string `env:"ADDR" env-default:":8080"`
	StaticDir string `env:"STATIC_DIR" env-default:"."`
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

	var cfg Config
	if err := config.Load(&cfg, config.WithSearchInDotEnvFile()); err != nil {
		log.Fatal("load config", zap.Error(err))
	}

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           newMux(cfg.StaticDir),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Info("listening", zap.String("addr", cfg.Addr))
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal("serve", zap.Error(err))
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown", zap.Error(err))
	}
}
