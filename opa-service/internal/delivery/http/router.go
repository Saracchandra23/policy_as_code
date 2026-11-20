package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"cf_ai_policy_as_code/opa-service/internal/application"
	"cf_ai_policy_as_code/opa-service/internal/domain"
)

const maxRequestBodyBytes = 1 << 20

type Router struct {
	syncUseCase      *application.SyncPolicyUseCase
	validateUseCase  *application.ValidatePolicyUseCase
	evaluateUseCase  *application.EvaluatePolicyUseCase
	configuration    *application.GetPDPConfigurationUseCase
	getBundleUseCase *application.GetBundleUseCase
}

func NewRouter(
	syncUseCase *application.SyncPolicyUseCase,
	validateUseCase *application.ValidatePolicyUseCase,
	evaluateUseCase *application.EvaluatePolicyUseCase,
	configuration *application.GetPDPConfigurationUseCase,
	getBundleUseCase *application.GetBundleUseCase,
) *Router {
	return &Router{
		syncUseCase:      syncUseCase,
		validateUseCase:  validateUseCase,
		evaluateUseCase:  evaluateUseCase,
		configuration:    configuration,
		getBundleUseCase: getBundleUseCase,
	}
}

func (r *Router) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", r.handleHealth)
	mux.HandleFunc("POST /policies/sync", r.handleSync)
	mux.HandleFunc("POST /validate", r.handleValidate)
	mux.HandleFunc("POST /access/v1/evaluation", r.handleEvaluation)
	mux.HandleFunc("GET /.well-known/authzen-configuration", r.handleConfiguration)
	mux.HandleFunc("GET /bundle-server/bundles/bundle.tar.gz", r.handleBundle)
	return mux
}

func (r *Router) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (r *Router) handleSync(w http.ResponseWriter, req *http.Request) {
	var dto SyncRequest
	if err := decodeJSON(w, req, &dto); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if strings.TrimSpace(dto.Rego) == "" || dto.Data == nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "rego and data are required")
		return
	}
	revision, err := r.syncUseCase.Execute(req.Context(), domain.PolicyDocument{Rego: dto.Rego, Data: dto.Data})
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, domain.ErrInvalidRego) {
			status = http.StatusBadRequest
		}
		writeError(w, status, errorName(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, SyncResponse{Revision: string(revision), Synced: true})
}

func (r *Router) handleValidate(w http.ResponseWriter, req *http.Request) {
	var dto ValidateRequest
	if err := decodeJSON(w, req, &dto); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if strings.TrimSpace(dto.Rego) == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "rego is required")
		return
	}
	if err := r.validateUseCase.Execute(req.Context(), dto.Rego); err != nil {
		writeJSON(w, http.StatusBadRequest, ValidateResponse{
			Valid: false, Error: errorName(err), Message: err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, ValidateResponse{Valid: true})
}

func (r *Router) handleEvaluation(w http.ResponseWriter, req *http.Request) {
	var dto AccessEvaluationRequestDTO
	if err := decodeJSON(w, req, &dto); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if err := validateAccessRequest(dto); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	result, err := r.evaluateUseCase.Execute(req.Context(), dto.Domain())
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, domain.ErrEngineNotReady) {
			status = http.StatusServiceUnavailable
		}
		writeError(w, status, errorName(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (r *Router) handleConfiguration(w http.ResponseWriter, req *http.Request) {
	configuration := r.configuration.Execute(req.Context())
	writeJSON(w, http.StatusOK, PDPConfigurationDTO{
		PolicyDecisionPoint:      configuration.PolicyDecisionPoint,
		AccessEvaluationEndpoint: configuration.AccessEvaluationEndpoint,
	})
}

func (r *Router) handleBundle(w http.ResponseWriter, req *http.Request) {
	body, revision, err := r.getBundleUseCase.Execute(req.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "bundle_unavailable", err.Error())
		return
	}
	etag := `"` + string(revision) + `"`
	w.Header().Set("ETag", etag)
	if matchesETag(req.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(body); err != nil {
		log.Printf("write bundle response: %v", err)
	}
}

func validateAccessRequest(dto AccessEvaluationRequestDTO) error {
	switch {
	case strings.TrimSpace(dto.Subject.Type) == "":
		return fmt.Errorf("subject.type is required")
	case strings.TrimSpace(dto.Subject.ID) == "":
		return fmt.Errorf("subject.id is required")
	case strings.TrimSpace(dto.Resource.Type) == "":
		return fmt.Errorf("resource.type is required")
	case strings.TrimSpace(dto.Resource.ID) == "":
		return fmt.Errorf("resource.id is required")
	case strings.TrimSpace(dto.Action.Name) == "":
		return fmt.Errorf("action.name is required")
	case dto.Context == nil:
		return fmt.Errorf("context is required")
	default:
		return nil
	}
}

func decodeJSON(w http.ResponseWriter, req *http.Request, destination any) error {
	req.Body = http.MaxBytesReader(w, req.Body, maxRequestBodyBytes)
	decoder := json.NewDecoder(req.Body)
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("decode JSON request: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("decode JSON request: multiple values")
		}
		return fmt.Errorf("decode JSON request: %w", err)
	}
	return nil
}

func matchesETag(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || candidate == etag {
			return true
		}
	}
	return false
}

func errorName(err error) string {
	switch {
	case errors.Is(err, domain.ErrInvalidRego):
		return domain.ErrInvalidRego.Error()
	case errors.Is(err, domain.ErrEngineNotReady):
		return domain.ErrEngineNotReady.Error()
	default:
		return "internal_error"
	}
}

func writeError(w http.ResponseWriter, status int, name, message string) {
	writeJSON(w, status, ErrorResponse{Error: name, Message: message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("encode HTTP response: %v", err)
	}
}
