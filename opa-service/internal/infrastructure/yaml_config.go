package infrastructure

import (
	"context"
	"fmt"
	"os"
)

func LoadOPAConfig(ctx context.Context, path string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("load OPA config: %w", err)
	}
	if path == "" {
		path = os.Getenv("OPA_CONFIG_PATH")
	}
	if path == "" {
		path = "./config/opa-config.yaml"
	}
	config, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read OPA config %q: %w", path, err)
	}
	return config, nil
}
