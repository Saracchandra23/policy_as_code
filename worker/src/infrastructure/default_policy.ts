export const DEFAULT_AUTHZ_POLICY = `package authz
import rego.v1

default allow := false

allow if {
	input.subject.type == "user"
	input.subject.id != ""
	input.action.name == "read_report"
	input.resource.type == "report"
	input.resource.id != ""
	input.context.authenticated == true
	some role in input.subject.properties.roles
	role in {"viewer", "editor", "admin"}
}

allow if {
	input.subject.type == "user"
	input.subject.id != ""
	input.action.name == "publish_report"
	input.resource.type == "report"
	input.resource.id != ""
	input.resource.properties.status == "draft"
	input.context.authenticated == true
	some role in input.subject.properties.roles
	role in {"editor", "admin"}
}

allow if {
	input.subject.type == "user"
	input.subject.id != ""
	input.action.name == "delete_workspace"
	input.resource.type == "workspace"
	input.resource.id != ""
	input.context.authenticated == true
	some role in input.subject.properties.roles
	role == "admin"
}

reasons contains msg if {
	allow
	msg := "authenticated user may perform this policy action"
}

reasons contains msg if {
	not allow
	msg := "authorization requirements were not met"
}`.trim();