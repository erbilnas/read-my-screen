const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string; code?: number };
};

export async function analyzeImageWithGemini(
  apiKey: string,
  model: string,
  base64Image: string,
  userPrompt: string,
  imageMediaType = "image/png",
): Promise<string> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }, { inlineData: { mimeType: imageMediaType, data: base64Image } }],
        },
      ],
    }),
  });

  const data = (await res.json()) as GenerateContentResponse;

  if (!res.ok) {
    const msg = data.error?.message || res.statusText || `HTTP ${res.status}`;
    throw new Error(formatGeminiHttpError(res.status, msg));
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("The model returned an empty response.");
  }
  return trimmed;
}

export async function analyzeTextWithGemini(apiKey: string, model: string, userMessage: string): Promise<string> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
    }),
  });

  const data = (await res.json()) as GenerateContentResponse;

  if (!res.ok) {
    const msg = data.error?.message || res.statusText || `HTTP ${res.status}`;
    throw new Error(formatGeminiHttpError(res.status, msg));
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("The model returned an empty response.");
  }
  return trimmed;
}

function formatGeminiHttpError(status: number, message: string): string {
  if (status === 400 && message.toLowerCase().includes("api key")) {
    return "Invalid Google AI API key. Check Screen AI → Google Gemini API key in preferences.";
  }
  if (status === 401 || status === 403) {
    return "Invalid or forbidden Google AI API key. Check Screen AI → Google Gemini API key in preferences.";
  }
  if (status === 429) {
    return "Rate limited by Google. Try again in a moment.";
  }
  return message;
}

export function formatGeminiError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
