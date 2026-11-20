package authz
import rego.v1

default allow := false

allow if {
	input.subject.type == "user"
	input.context.authenticated == true
	input.resource.type == "document"
	input.resource.properties.classification != "restricted"
	some role in input.subject.properties.roles
	input.action.name in data.roles[role]
}

allow if {
	input.subject.type == "user"
	input.context.authenticated == true
	input.resource.type == "report"
	input.action.name == "read_report"
	some role in input.subject.properties.roles
	input.action.name in data.roles[role]
}

allow if {
	input.subject.type == "user"
	input.context.authenticated == true
	input.resource.type == "report"
	input.resource.properties.status == "draft"
	input.action.name == "publish_report"
	some role in input.subject.properties.roles
	input.action.name in data.roles[role]
}

allow if {
	input.subject.type == "user"
	input.context.authenticated == true
	input.resource.type == "workspace"
	input.resource.id != ""
	input.action.name == "delete_workspace"
	some role in input.subject.properties.roles
	input.action.name in data.roles[role]
}

reasons contains "authorization granted" if {
	allow
}

reasons contains "authorization requirements were not met" if {
	not allow
}
