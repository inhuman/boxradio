package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestServer(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>box radio</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.js"), []byte("'use strict';"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(newMux(dir))
	defer srv.Close()

	tests := []struct {
		name     string
		path     string
		wantCode int
		wantBody string
	}{
		{"healthz", "/healthz", http.StatusOK, "ok"},
		{"index", "/", http.StatusOK, "<h1>box radio</h1>"},
		{"app.js", "/app.js", http.StatusOK, "'use strict';"},
		{"missing", "/nope.txt", http.StatusNotFound, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := http.Get(srv.URL + tt.path)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tt.wantCode {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tt.wantCode)
			}
			if tt.wantBody != "" {
				body, _ := io.ReadAll(resp.Body)
				if string(body) != tt.wantBody {
					t.Fatalf("body = %q, want %q", body, tt.wantBody)
				}
			}
		})
	}
}
