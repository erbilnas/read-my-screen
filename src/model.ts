export type Provider = "openai" | "anthropic" | "gemini";

export type ParsedModel = {
  provider: Provider;
  modelId: string;
};

/** Preference value format: `provider:modelId` (e.g. `openai:gpt-4o-mini`). */
export function parseModelPreference(value: string): ParsedModel {
  const idx = value.indexOf(":");
  if (idx <= 0) {
    return { provider: "openai", modelId: value || "gpt-4o-mini" };
  }
  const provider = value.slice(0, idx) as Provider;
  const modelId = value.slice(idx + 1);
  if (provider !== "openai" && provider !== "anthropic" && provider !== "gemini") {
    return { provider: "openai", modelId: value };
  }
  return { provider, modelId };
}
