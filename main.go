// boxradio — internet radio player server.
//
// Serves the player frontend (static assets) and reverse-proxies the live
// endpoints to a failover list of backend stream nodes:
//
//	/ws                     WebSocket metadata channel (bidirectional)
//	/stream/{path...}       long-lived chunked audio stream (GET)
//	/api/buffer, /telemetry player telemetry (POST)
//
// This is the Go port of the former Cloudflare Worker (_worker.js), intended
// to run on a plain VPS so the site no longer depends on Cloudflare's edge.
package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/inhuman/config"
	"go.uber.org/zap"
)

type Config struct {
	Addr        string   `env:"ADDR" env-default:":8080"`
	StaticDir   string   `env:"STATIC_DIR" env-default:"."`
	StreamNodes []string `env:"STREAM_NODES"`
}

type server struct {
	log   *zap.Logger
	nodes []string

	upgrader     websocket.Upgrader
	dialer       *websocket.Dialer
	streamClient *http.Client // long-lived streams: no overall timeout
	bufferClient *http.Client // short telemetry POSTs
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

	nodes := parseNodes(cfg.StreamNodes)
	if len(nodes) == 0 {
		log.Warn("no STREAM_NODES configured — /ws, /stream and /api/buffer will return 503")
	}

	srv := &server{
		log:   log,
		nodes: nodes,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(*http.Request) bool { return true },
		},
		dialer: &websocket.Dialer{
			HandshakeTimeout: 10 * time.Second,
			Proxy:            http.ProxyFromEnvironment,
		},
		streamClient: &http.Client{
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				ResponseHeaderTimeout: 15 * time.Second,
				IdleConnTimeout:       90 * time.Second,
			},
		},
		bufferClient: &http.Client{Timeout: 10 * time.Second},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", srv.handleWS)
	mux.HandleFunc("GET /stream/", srv.handleStream)
	mux.HandleFunc("POST /api/buffer", srv.handleBuffer)
	mux.HandleFunc("POST /api/telemetry", srv.handleBuffer)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})
	mux.Handle("/", http.FileServer(http.Dir(cfg.StaticDir)))

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Info("listening", zap.String("addr", cfg.Addr), zap.Int("nodes", len(nodes)))
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

// handleWS proxies the WebSocket upgrade to the first reachable backend node,
// then pumps messages in both directions until either side closes.
func (s *server) handleWS(w http.ResponseWriter, r *http.Request) {
	var upstream *websocket.Conn
	for _, node := range s.nodes {
		conn, resp, err := s.dialer.Dial(toWS(node)+"/ws", nil)
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if err != nil {
			s.log.Debug("ws dial failed", zap.String("node", node), zap.Error(err))
			continue
		}
		upstream = conn
		break
	}
	if upstream == nil {
		http.Error(w, "stream unavailable", http.StatusServiceUnavailable)
		return
	}

	client, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Debug("client upgrade failed", zap.Error(err))
		_ = upstream.Close()
		return
	}

	pumpWS(client, upstream)
}

// pumpWS copies messages between two WebSocket connections until one errors,
// then closes both, remapping absent/abnormal close codes (1005/1006) to 1011
// to match the original worker's behaviour.
func pumpWS(a, b *websocket.Conn) {
	errc := make(chan error, 2)
	copyMsgs := func(dst, src *websocket.Conn) {
		for {
			mt, msg, err := src.ReadMessage()
			if err != nil {
				errc <- err
				return
			}
			if err := dst.WriteMessage(mt, msg); err != nil {
				errc <- err
				return
			}
		}
	}
	go copyMsgs(a, b)
	go copyMsgs(b, a)

	code := closeCode(<-errc)
	deadline := time.Now().Add(time.Second)
	msg := websocket.FormatCloseMessage(code, "")
	_ = a.WriteControl(websocket.CloseMessage, msg, deadline)
	_ = b.WriteControl(websocket.CloseMessage, msg, deadline)
	_ = a.Close()
	_ = b.Close()
}

func closeCode(err error) int {
	if ce, ok := errors.AsType[*websocket.CloseError](err); ok {
		if ce.Code == websocket.CloseNoStatusReceived || ce.Code == websocket.CloseAbnormalClosure {
			return websocket.CloseInternalServerErr
		}
		return ce.Code
	}
	return websocket.CloseInternalServerErr
}

// handleStream proxies GET /stream/{path} to a backend node and relays the
// long-lived chunked body, flushing as data arrives.
func (s *server) handleStream(w http.ResponseWriter, r *http.Request) {
	for _, node := range s.nodes {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, toHTTP(node)+r.URL.Path, nil)
		if err != nil {
			continue
		}
		copyHeaders(req.Header, r.Header, "Accept", "X-Session-Token", "Cache-Control")

		resp, err := s.streamClient.Do(req)
		if err != nil {
			s.log.Debug("stream fetch failed", zap.String("node", node), zap.Error(err))
			continue
		}

		h := w.Header()
		h.Set("Content-Type", cmpString(resp.Header.Get("Content-Type"), "application/octet-stream"))
		h.Set("X-Accel-Buffering", "no")
		h.Set("Cache-Control", "no-cache")
		h.Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(resp.StatusCode)

		flushCopy(w, resp.Body)
		_ = resp.Body.Close()
		return
	}
	http.Error(w, "stream unavailable", http.StatusServiceUnavailable)
}

// handleBuffer proxies a player-telemetry POST to a backend node. The body is
// buffered once so it can be retried across nodes on failure.
func (s *server) handleBuffer(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	for _, node := range s.nodes {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, toHTTP(node)+"/api/buffer", strings.NewReader(string(body)))
		if err != nil {
			continue
		}
		copyHeaders(req.Header, r.Header, "Content-Type", "X-Session-Token", "X-Seq")

		resp, err := s.bufferClient.Do(req)
		if err != nil {
			s.log.Debug("buffer post failed", zap.String("node", node), zap.Error(err))
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()

		w.Header().Set("Content-Length", "0")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.WriteHeader(resp.StatusCode)
		return
	}
	http.Error(w, "unavailable", http.StatusServiceUnavailable)
}

func parseNodes(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, n := range raw {
		if n = strings.TrimRight(strings.TrimSpace(n), "/"); n != "" {
			out = append(out, n)
		}
	}
	return out
}

func copyHeaders(dst, src http.Header, names ...string) {
	for _, name := range names {
		if v := src.Get(name); v != "" {
			dst.Set(name, v)
		}
	}
}

// flushCopy streams src to w, flushing after each read so audio chunks reach
// the client immediately instead of being buffered.
func flushCopy(w http.ResponseWriter, src io.Reader) {
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

func cmpString(v, fallback string) string {
	if v != "" {
		return v
	}
	return fallback
}

// toWS / toHTTP normalise a node base URL for the right scheme. Nodes may be
// configured with either an http(s):// or ws(s):// scheme (or none).
func toWS(node string) string {
	switch {
	case strings.HasPrefix(node, "ws://"), strings.HasPrefix(node, "wss://"):
		return node
	case strings.HasPrefix(node, "https://"):
		return "wss://" + strings.TrimPrefix(node, "https://")
	case strings.HasPrefix(node, "http://"):
		return "ws://" + strings.TrimPrefix(node, "http://")
	default:
		return "ws://" + node
	}
}

func toHTTP(node string) string {
	switch {
	case strings.HasPrefix(node, "http://"), strings.HasPrefix(node, "https://"):
		return node
	case strings.HasPrefix(node, "wss://"):
		return "https://" + strings.TrimPrefix(node, "wss://")
	case strings.HasPrefix(node, "ws://"):
		return "http://" + strings.TrimPrefix(node, "ws://")
	default:
		return "http://" + node
	}
}
