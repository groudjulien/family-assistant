import { decryptSecret } from "./crypto";

/**
 * Clé API Claude effective : celle saisie par le foyer (chiffrée en base) en
 * priorité, sinon la variable d'environnement. Renvoie null si aucune dispo.
 */
export async function resolveAnthropicKey(
  household: { anthropicApiKey: string | null },
  env: { SESSION_SECRET: string; ANTHROPIC_API_KEY?: string },
): Promise<string | null> {
  if (household.anthropicApiKey) {
    const key = await decryptSecret(household.anthropicApiKey, env.SESSION_SECRET);
    if (key) return key;
  }
  return env.ANTHROPIC_API_KEY || null;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  content: { type: string; text: string }[];
  usage: { input_tokens: number; output_tokens: number };
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callClaude(
  apiKey: string,
  model: string,
  system: string,
  messages: AnthropicMessage[],
  maxTokens = 1024,
): Promise<ChatResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${await res.text()}`);
  const json = (await res.json()) as AnthropicResponse;
  const text = json.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return {
    text,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Tool use (function calling)                                         */
/* ------------------------------------------------------------------ */

export interface ClaudeToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ClaudeToolTurn {
  stopReason: string;
  blocks: ClaudeContentBlock[];
  inputTokens: number;
  outputTokens: number;
}

export interface ToolMessage {
  role: "user" | "assistant";
  content: unknown; // string ou tableau de blocs (text / tool_use / tool_result)
}

export async function callClaudeTools(
  apiKey: string,
  model: string,
  system: string,
  messages: ToolMessage[],
  tools: object[],
  maxTokens = 1536,
): Promise<ClaudeToolTurn> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, tools, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${await res.text()}`);
  const json = (await res.json()) as {
    content: ClaudeContentBlock[];
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };
  return {
    stopReason: json.stop_reason,
    blocks: json.content ?? [],
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
  };
}
