package domain

type DomainError string

func (e DomainError) Error() string {
	return string(e)
}

const (
	ErrInvalidRego    DomainError = "ErrInvalidRego"
	ErrEngineNotReady DomainError = "ErrEngineNotReady"
)
