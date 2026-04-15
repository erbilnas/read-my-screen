import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export async function analyzeImageWithOpenAI(
  apiKey: string,
  model: string,
  base64Image: string,
  userPrompt: string,
  imageMediaType = "image/png",
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${imageMediaType};base64,${base64Image}`,
              detail: "auto",
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
  });

  const text = response.choices[0]?.message?.content;
  if (!text || !text.trim()) {
    throw new Error("The model returned an empty response.");
  }
  return text.trim();
}

export async function chatWithHistoryOpenAI(
  apiKey: string,
  model: string,
  messages: ChatCompletionMessageParam[],
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: 8192,
  });

  const text = response.choices[0]?.message?.content;
  if (!text || !text.trim()) {
    throw new Error("The model returned an empty response.");
  }
  return text.trim();
}

export async function analyzeTextWithOpenAI(apiKey: string, model: string, userMessage: string): Promise<string> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: userMessage }],
    max_tokens: 8192,
  });

  const text = response.choices[0]?.message?.content;
  if (!text || !text.trim()) {
    throw new Error("The model returned an empty response.");
  }
  return text.trim();
}

export function formatOpenAIError(err: unknown): string {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: number }).status;
    if (status === 401) {
      return "Invalid API key. Check your OpenAI API key in extension preferences.";
    }
    if (status === 429) {
      return "Rate limited by OpenAI. Try again in a moment.";
    }
    if (status === 400) {
      const msg = (err as { message?: string }).message;
      return msg ? `OpenAI request error: ${msg}` : "Invalid request to OpenAI (check model name and image size).";
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
