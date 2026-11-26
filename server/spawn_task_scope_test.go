package server

import (
	"strings"
	"testing"
)

func TestNormalizeSpawnScope(t *testing.T) {
	got, err := normalizeSpawnScope([]spawnScope{
		{Kind: " Subdomain ", Value: " app.acme.com "},
		{Kind: "subdomain", Value: "APP.acme.com"}, // duplicate, different case
		{Kind: "cidr", Value: "10.0.0.0/24"},
		{Kind: "ip", Value: "  "}, // empty value is dropped
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []spawnScope{{Kind: "subdomain", Value: "app.acme.com"}, {Kind: "cidr", Value: "10.0.0.0/24"}}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("entry %d: got %v, want %v", i, got[i], want[i])
		}
	}
}

func TestNormalizeSpawnScopeRejects(t *testing.T) {
	if _, err := normalizeSpawnScope([]spawnScope{{Kind: "icp", Value: "123"}}); err == nil {
		t.Fatal("icp must be rejected")
	}
	if _, err := normalizeSpawnScope([]spawnScope{{Kind: "url", Value: "https://x"}}); err == nil {
		t.Fatal("unknown kind must be rejected")
	}
	many := make([]spawnScope, maxSpawnScope+1)
	for i := range many {
		many[i] = spawnScope{Kind: "ip", Value: "10.0.0.1"}
	}
	if _, err := normalizeSpawnScope(many); err == nil {
		t.Fatal("more than maxSpawnScope entries must be rejected")
	}
}

func TestSpawnConfirmMessage(t *testing.T) {
	msg := spawnConfirmMessage("Web · app.acme.com", "web track", "find auth flaws", []spawnScope{{Kind: "subdomain", Value: "app.acme.com"}})
	for _, part := range []string{"Web · app.acme.com", "find auth flaws", "subdomain app.acme.com"} {
		if !strings.Contains(msg, part) {
			t.Fatalf("message %q lacks %q", msg, part)
		}
	}
	if got := spawnConfirmMessage("", "network track", "map hosts", nil); !strings.Contains(got, "network track") || !strings.Contains(got, "none given") {
		t.Fatalf("fallback title or empty scope missing: %q", got)
	}
}
