package domain

type Revision string

type PolicyDocument struct {
	Rego string
	Data map[string]any
}

type BundleSnapshot struct {
	Revision Revision
	Rego     string
	DataJSON []byte
	Manifest []byte
}
