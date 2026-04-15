/** Normalized token counts from OpenAI, Anthropic, or Gemini responses. */
export type TokenUsage = {
  input?: number;
  output?: number;
  total?: number;
};

export type ModelResponse = {
  text: string;
  usage?: TokenUsage;
};

export function formatUsageHint(usage: TokenUsage | undefined, enabled: boolean): string {
  if (!enabled || !usage) {
    return "";
  }
  const ins = usage.input;
  const outs = usage.output;
  const tot = usage.total;
  if (ins !== undefined && outs !== undefined) {
    return ` · ${ins} in / ${outs} out tok`;
  }
  if (tot !== undefined) {
    return ` · ${tot} tok (total)`;
  }
  return "";
}
