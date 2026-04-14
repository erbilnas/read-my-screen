const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

type MessagesResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
};

export async function analyzeImageWithAnthropic(
  apiKey: string,
  model: string,
  base64Png: string,
  userPrompt: string,
): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64Png,
              },
            },
            { type: "text", text: userPrompt },
          ],
        },
      ],
    }),
  });

  const data = (await res.json()) as MessagesResponse;

  if (!res.ok) {
    const msg = data.error?.message || res.statusText || `HTTP ${res.status}`;
    throw new Error(formatAnthropicHttpError(res.status, msg));
  }

  const parts = data.content;
  if (!parts?.length) {
    throw new Error("The model returned an empty response.");
  }
  const text = parts.map((p) => (p.type === "text" && p.text ? p.text : "")).join("");
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("The model returned an empty response.");
  }
  return trimmed;
}

function formatAnthropicHttpError(status: number, message: string): string {
  if (status === 401) {
    return "Invalid Anthropic API key. Check Screen AI → Anthropic API key in preferences.";
  }
  if (status === 429) {
    return "Rate limited by Anthropic. Try again in a moment.";
  }
  return message;
}

export function formatAnthropicError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
