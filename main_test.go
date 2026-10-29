package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// backend node: ws echo + stream + buffer
func newBackend(t *testing.T) *httptest.Server {
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, []byte(`{"station":"X","track":"T"}`))
		for {
			mt, m, err := c.ReadMessage()
			if err != nil {
				return
			}
			_ = c.WriteMessage(mt, append([]byte("echo:"), m...))
		}
	})
	mux.HandleFunc("/stream/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		io.WriteString(w, "AUDIODATA:"+r.URL.Path)
	})
	mux.HandleFunc("/api/buffer", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		if string(b) != "ping" || r.Header.Get("X-Seq") != "7" {
			w.WriteHeader(422)
			return
		}
		w.WriteHeader(204)
	})
	return httptest.NewServer(mux)
}

func newFront(t *testing.T, nodes []string) *httptest.Server {
	s := &server{
		nodes:        nodes,
		upgrader:     websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }},
		dialer:       websocket.DefaultDialer,
		streamClient: http.DefaultClient,
		bufferClient: http.DefaultClient,
	}
	// minimal logger
	s.log = zap.NewNop()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", s.handleWS)
	mux.HandleFunc("GET /stream/", s.handleStream)
	mux.HandleFunc("POST /api/buffer", s.handleBuffer)
	return httptest.NewServer(mux)
}

func TestSmoke(t *testing.T) {
	be := newBackend(t)
	defer be.Close()
	fe := newFront(t, []string{be.URL})
	defer fe.Close()

	// stream
	resp, err := http.Get(fe.URL + "/stream/groovesalad")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	if string(b) != "AUDIODATA:/stream/groovesalad" || resp.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("stream bad: %q hdr=%q", b, resp.Header.Get("Access-Control-Allow-Origin"))
	}

	// buffer
	req, _ := http.NewRequest("POST", fe.URL+"/api/buffer", strings.NewReader("ping"))
	req.Header.Set("X-Seq", "7")
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp2.StatusCode != 204 {
		t.Fatalf("buffer status %d", resp2.StatusCode)
	}

	// ws
	wsURL := "ws" + strings.TrimPrefix(fe.URL, "http")
	c, _, err := websocket.DefaultDialer.Dial(wsURL+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, m, err := c.ReadMessage()
	if err != nil || string(m) != `{"station":"X","track":"T"}` {
		t.Fatalf("ws first msg %q err=%v", m, err)
	}
	_ = c.WriteMessage(websocket.TextMessage, []byte("hi"))
	_, m2, err := c.ReadMessage()
	if err != nil || string(m2) != "echo:hi" {
		t.Fatalf("ws echo %q err=%v", m2, err)
	}
}

func TestNoNodes503(t *testing.T) {
	fe := newFront(t, nil)
	defer fe.Close()
	resp, _ := http.Get(fe.URL + "/stream/x")
	if resp.StatusCode != 503 {
		t.Fatalf("want 503 got %d", resp.StatusCode)
	}
}

func TestSchemeNormalise(t *testing.T) {
	cases := map[string][2]string{ // node -> {wantWS, wantHTTP}
		"host:80":   {"ws://host:80", "http://host:80"},
		"http://h":  {"ws://h", "http://h"},
		"https://h": {"wss://h", "https://h"},
		"ws://h":    {"ws://h", "http://h"},
		"wss://h":   {"wss://h", "https://h"},
	}
	for node, want := range cases {
		if got := toWS(node); got != want[0] {
			t.Errorf("toWS(%q)=%q want %q", node, got, want[0])
		}
		if got := toHTTP(node); got != want[1] {
			t.Errorf("toHTTP(%q)=%q want %q", node, got, want[1])
		}
	}
	_ = url.URL{}
}
