package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cf_ai_policy_as_code/opa-service/internal/di"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	container, err := di.NewContainer(ctx, os.Getenv("OPA_CONFIG_PATH"))
	if err != nil {
		return fmt.Errorf("initialize policy service: %w", err)
	}
	defer container.Close(context.Background())

	server := &http.Server{
		Addr:              ":8080",
		Handler:           container.Handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
	}()

	log.Printf("OPA policy service listening on :8080")
	select {
	case <-ctx.Done():
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shut down HTTP server: %w", err)
		}
		return nil
	case err := <-serverErrors:
		return fmt.Errorf("serve policy service: %w", err)
	}
}
