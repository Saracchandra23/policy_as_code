package infrastructure

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"

	"cf_ai_policy_as_code/opa-service/internal/domain"
)

const validRego = `package authz

import rego.v1

default allow := false
`

func TestBundleTarGzContainsPolicyAndData(t *testing.T) {
	store, err := NewBundleStore(validRego, map[string]any{"roles": map[string]any{"viewer": []string{"read"}}})
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	body, revision, err := store.TarGz(context.Background())
	if err != nil {
		t.Fatalf("create bundle: %v", err)
	}
	gz, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("open gzip bundle: %v", err)
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	files := map[string][]byte{}
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("read tar entry: %v", err)
		}
		content, err := io.ReadAll(reader)
		if err != nil {
			t.Fatalf("read %s: %v", header.Name, err)
		}
		files[header.Name] = content
	}
	for _, name := range []string{".manifest", "data.json", "authz.rego"} {
		if _, ok := files[name]; !ok {
			t.Errorf("bundle missing %s", name)
		}
	}
	if !strings.Contains(string(files["authz.rego"]), "package authz") {
		t.Errorf("bundle policy does not contain authz package")
	}
	var manifest struct {
		Revision string   `json:"revision"`
		Roots    []string `json:"roots"`
	}
	if err := json.Unmarshal(files[".manifest"], &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	if manifest.Revision != string(revision) || len(manifest.Roots) != 1 || manifest.Roots[0] != "" {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
}

func TestBundleStoreSyncChangesRevision(t *testing.T) {
	store, err := NewBundleStore(validRego, map[string]any{"roles": map[string]any{}})
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	first, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	revision, err := store.Sync(context.Background(), policyWithRego(validRego+"\nallow if true\n"))
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if revision == "" || revision == first.Revision {
		t.Fatalf("expected changed revision, got %q", revision)
	}
}

func TestBundleStoreRejectsInvalidRego(t *testing.T) {
	store, err := NewBundleStore(validRego, map[string]any{})
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	_, err = store.Sync(context.Background(), policyWithRego("not valid rego"))
	if err == nil {
		t.Fatal("expected invalid Rego error")
	}
}

func TestBundleStoreRequiresAuthZenRegoV1Headers(t *testing.T) {
	tests := []struct {
		name string
		rego string
	}{
		{name: "missing rego v1 import", rego: "package authz\n\ndefault allow := false"},
		{name: "wrong package", rego: "package other\n\nimport rego.v1\n\ndefault allow := false"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NewBundleStore(test.rego, map[string]any{})
			if err == nil {
				t.Fatal("expected invalid Rego error")
			}
		})
	}
}

func policyWithRego(rego string) domain.PolicyDocument {
	return domain.PolicyDocument{Rego: rego, Data: map[string]any{}}
}
