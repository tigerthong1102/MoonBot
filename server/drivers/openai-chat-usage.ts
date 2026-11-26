import type { ProviderBody } from "./openai-chat-refusals.ts";

export interface Usage {
  costUsd?: number;
  cachedInput?: number;
  input: number;
  output: number;
}

export interface CompletionJson extends ProviderBody {
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; reasoning_details?: unknown; tool_calls?: unknown; function_call?: unknown };
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; reasoning_details?: unknown; tool_calls?: unknown; function_call?: unknown };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number };
  /** Groq reports streaming usage in its final x_groq envelope. */
  x_groq?: { usage?: CompletionJson["usage"] };
}

export const usageFrom = (usage: CompletionJson["usage"]): Usage | null =>
  usage
    ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0,
        ...(typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? { costUsd: usage.cost } : {}),
        ...(usage.prompt_tokens_details?.cached_tokens !== undefined ? { cachedInput: usage.prompt_tokens_details.cached_tokens } : {}),
      }
    : null;

export const completionUsage = (json: CompletionJson) => json.usage ?? json.x_groq?.usage;

