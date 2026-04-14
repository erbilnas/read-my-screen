import { analyzeImageWithAnthropic } from "./anthropic-vision";
import { analyzeImageWithGemini } from "./gemini-vision";
import type { ParsedModel } from "./model";
import { analyzeImageWithOpenAI, formatOpenAIError } from "./openai-vision";

export async function analyzeImage(
  prefs: Preferences,
  parsed: ParsedModel,
  base64Png: string,
  userPrompt: string,
): Promise<string> {
  const { provider, modelId } = parsed;

  if (provider === "openai") {
    const key = prefs.openaiApiKey?.trim();
    if (!key) {
      throw new Error("Add your OpenAI API key in Screen AI extension preferences.");
    }
    return analyzeImageWithOpenAI(key, modelId, base64Png, userPrompt);
  }

  if (provider === "anthropic") {
    const key = prefs.anthropicApiKey?.trim();
    if (!key) {
      throw new Error("Add your Anthropic API key in Screen AI extension preferences.");
    }
    return analyzeImageWithAnthropic(key, modelId, base64Png, userPrompt);
  }

  const key = prefs.geminiApiKey?.trim();
  if (!key) {
    throw new Error("Add your Google Gemini API key in Screen AI extension preferences.");
  }
  return analyzeImageWithGemini(key, modelId, base64Png, userPrompt);
}

export function formatVisionError(err: unknown): string {
  if (err && typeof err === "object" && "status" in err) {
    return formatOpenAIError(err);
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
