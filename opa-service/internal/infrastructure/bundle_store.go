package infrastructure

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/open-policy-agent/opa/v1/ast"

	"cf_ai_policy_as_code/opa-service/internal/domain"
)

type BundleStore struct {
	mu       sync.RWMutex
	rego     string
	dataJSON []byte
	revision domain.Revision
}

func NewBundleStore(rego string, data map[string]any) (*BundleStore, error) {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("encode seed data: %w", err)
	}
	store := &BundleStore{rego: rego, dataJSON: dataJSON}
	if err := store.Validate(context.Background(), rego); err != nil {
		return nil, fmt.Errorf("validate seed Rego: %w", err)
	}
	revision, err := policyRevision(rego, dataJSON)
	if err != nil {
		return nil, err
	}
	store.revision = revision
	return store, nil
}

func (s *BundleStore) Validate(ctx context.Context, rego string) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("validate Rego: %w", err)
	}
	lines := strings.Split(strings.ReplaceAll(rego, "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "package authz" {
		return fmt.Errorf("%w: policy must begin with package authz", domain.ErrInvalidRego)
	}
	hasRegoV1Import := false
	for _, line := range lines {
		if strings.TrimSpace(line) == "import rego.v1" {
			hasRegoV1Import = true
			break
		}
	}
	if !hasRegoV1Import {
		return fmt.Errorf("%w: policy must import rego.v1", domain.ErrInvalidRego)
	}
	module, err := ast.ParseModule("authz.rego", rego)
	if err != nil {
		return fmt.Errorf("%w: %v", domain.ErrInvalidRego, err)
	}
	if module.Package.Path.String() != "data.authz" {
		return fmt.Errorf("%w: policy must use package authz", domain.ErrInvalidRego)
	}
	compiler := ast.NewCompiler()
	compiler.Compile(map[string]*ast.Module{"authz.rego": module})
	if compiler.Failed() {
		return fmt.Errorf("%w: %v", domain.ErrInvalidRego, compiler.Errors)
	}
	return nil
}

func (s *BundleStore) Sync(ctx context.Context, policy domain.PolicyDocument) (domain.Revision, error) {
	if err := s.Validate(ctx, policy.Rego); err != nil {
		return "", err
	}
	dataJSON, err := json.Marshal(policy.Data)
	if err != nil {
		return "", fmt.Errorf("encode policy data: %w", err)
	}
	revision, err := policyRevision(policy.Rego, dataJSON)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.rego = policy.Rego
	s.dataJSON = dataJSON
	s.revision = revision
	s.mu.Unlock()
	return revision, nil
}

func (s *BundleStore) Snapshot(ctx context.Context) (domain.BundleSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return domain.BundleSnapshot{}, fmt.Errorf("read bundle snapshot: %w", err)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	manifest, err := json.Marshal(map[string]any{
		"revision": string(s.revision),
		"roots":    []string{""},
	})
	if err != nil {
		return domain.BundleSnapshot{}, fmt.Errorf("encode manifest: %w", err)
	}
	return domain.BundleSnapshot{
		Revision: s.revision,
		Rego:     s.rego,
		DataJSON: append([]byte(nil), s.dataJSON...),
		Manifest: manifest,
	}, nil
}

func (s *BundleStore) TarGz(ctx context.Context) ([]byte, domain.Revision, error) {
	snapshot, err := s.Snapshot(ctx)
	if err != nil {
		return nil, "", err
	}
	files := map[string][]byte{
		".manifest":  snapshot.Manifest,
		"data.json":  snapshot.DataJSON,
		"authz.rego": []byte(snapshot.Rego),
	}
	var out bytes.Buffer
	gz := gzip.NewWriter(&out)
	tw := tar.NewWriter(gz)
	for _, name := range []string{".manifest", "data.json", "authz.rego"} {
		body := files[name]
		header := &tar.Header{Name: name, Mode: 0600, Size: int64(len(body)), ModTime: time.Unix(0, 0)}
		if err := tw.WriteHeader(header); err != nil {
			return nil, "", fmt.Errorf("write bundle header: %w", err)
		}
		if _, err := tw.Write(body); err != nil {
			return nil, "", fmt.Errorf("write bundle body: %w", err)
		}
	}
	if err := tw.Close(); err != nil {
		return nil, "", fmt.Errorf("close bundle tar: %w", err)
	}
	if err := gz.Close(); err != nil {
		return nil, "", fmt.Errorf("close bundle gzip: %w", err)
	}
	return out.Bytes(), snapshot.Revision, nil
}

func policyRevision(rego string, dataJSON []byte) (domain.Revision, error) {
	if _, err := ast.ParseModule("authz.rego", rego); err != nil {
		return "", fmt.Errorf("%w: %v", domain.ErrInvalidRego, err)
	}
	sum := sha256.Sum256(append(append([]byte(nil), []byte(rego)...), dataJSON...))
	return domain.Revision(fmt.Sprintf("%x", sum[:12])), nil
}
