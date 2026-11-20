import type { CopilotLLMPort } from "../application/ports";
import type {
  AccessEvaluationRequest,
  AccessEvaluationResponse,
} from "../domain/authzen";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const REGOV1_SYSTEM_PROMPT = `You are a Rego v1 policy author. Return ONLY complete Rego v1 source code, with no prose or markdown. The first lines must be exactly:
package authz

import rego.v1

The policy must evaluate input.subject, input.action, input.resource, and input.context. It must include:
default allow := false
allow if { ... }
reasons contains msg if { ... }
Use only Rego v1 syntax and do not invent input fields beyond those requested.`;

interface LlamaMessage {
  role: "system" | "user";
  content: string;
}

interface LlamaResponse {
  response?: string;
}

export class WorkersAILlamaAdapter implements CopilotLLMPort {
  constructor(private readonly ai: Ai) {}

  async generateRegoV1(
    prompt: string,
    currentRego: string,
  ): Promise<{ regoCode: string; explanation: string }> {
    const response = await this.run([
      { role: "system", content: REGOV1_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Policy request:\n${prompt}\n\nCurrent policy:\n${currentRego || "(none)"}`,
      },
    ]);
    return { regoCode: extractRego(response), explanation: "Generated a Rego v1 policy candidate." };
  }

  async repairRegoV1(
    brokenRego: string,
    compilerErrors: string[],
    originalPrompt: string,
  ): Promise<{ regoCode: string; explanation: string }> {
    const response = await this.run([
      { role: "system", content: REGOV1_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Repair the Rego policy for this request:\n${originalPrompt}\n\nCompiler errors:\n${compilerErrors.join("\n")}\n\nBroken policy:\n${brokenRego}`,
      },
    ]);
    return {
      regoCode: extractRego(response),
      explanation: "Repaired the Rego v1 policy using the OPA validation errors.",
    };
  }

  async explainDenial(
    request: AccessEvaluationRequest,
    response: AccessEvaluationResponse,
    activeRego: string,
  ): Promise<string> {
    const result = await this.run([
      {
        role: "system",
        content: "Explain the authorization denial in concise, plain language. Do not output or modify policy code.",
      },
      {
        role: "user",
        content: `Request:\n${JSON.stringify(request)}\n\nDecision:\n${JSON.stringify(response)}\n\nActive policy:\n${activeRego}`,
      },
    ]);
    return result.trim();
  }

  private async run(messages: LlamaMessage[]): Promise<string> {
    const response: unknown = await this.ai.run(MODEL, { messages, max_tokens: 1500 });
    if (
      response === null ||
      typeof response !== "object" ||
      !("response" in response) ||
      typeof (response as LlamaResponse).response !== "string"
    ) {
      throw new Error("Workers AI returned an invalid Llama response");
    }
    return (response as LlamaResponse).response as string;
  }
}

function extractRego(response: string): string {
  const trimmed = response.trim();
  const fenced = /^```(?:rego)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const regoCode = (fenced?.[1] ?? trimmed).trim();
  const lines = regoCode.replaceAll("\r\n", "\n").split("\n");
  if (
    lines[0]?.trim() !== "package authz" ||
    lines[1]?.trim() !== "import rego.v1"
  ) {
    throw new Error("Workers AI output must begin with package authz and import rego.v1");
  }
  const requiredFragments = [
    "input.subject",
    "input.action",
    "input.resource",
    "input.context",
    "default allow := false",
    "allow if",
    "reasons contains",
  ];
  if (!requiredFragments.every((fragment) => regoCode.includes(fragment))) {
    throw new Error("Workers AI output does not satisfy the required Rego v1 policy structure");
  }
  return regoCode;
}
