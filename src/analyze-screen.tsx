import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  Toast,
  environment,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeImage, formatVisionError } from "./analyze-image";
import { CaptureError, CaptureMode, captureToFile, safeUnlink } from "./capture";
import { parseModelPreference } from "./model";

type FormValues = {
  mode: CaptureMode;
  prompt: string;
};

function analyzingLabel(parsed: ReturnType<typeof parseModelPreference>): string {
  switch (parsed.provider) {
    case "openai":
      return "Analyzing with OpenAI…";
    case "anthropic":
      return "Analyzing with Claude…";
    case "gemini":
      return "Analyzing with Gemini…";
    default:
      return "Analyzing…";
  }
}

export default function AnalyzeScreenCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const defaultPrompt =
    prefs.defaultPrompt?.trim() ||
    "Describe what you see on the screen. Call out any text, UI elements, errors, or notable details.";

  async function handleSubmit(values: FormValues) {
    const modelPref = prefs.model?.trim() || "openai:gpt-4o-mini";
    const parsed = parseModelPreference(modelPref);

    const prompt = values.prompt?.trim() || defaultPrompt;
    const outPath = join(environment.supportPath, `screen-ai-${Date.now()}.png`);

    const loading = await showToast({
      style: Toast.Style.Animated,
      title: "Capturing screenshot…",
    });

    try {
      await captureToFile(values.mode, outPath);
      loading.title = analyzingLabel(parsed);

      const base64 = readFileSync(outPath, { encoding: "base64" });
      const answer = await analyzeImage(prefs, parsed, base64, prompt);

      await Clipboard.copy(answer);
      loading.hide();
      await showToast({
        style: Toast.Style.Success,
        title: "Analysis copied to clipboard",
        message: "Paste it anywhere you need it.",
      });
    } catch (err) {
      loading.hide();
      if (err instanceof CaptureError) {
        const title =
          err.kind === "cancelled"
            ? "Capture cancelled"
            : err.kind === "permission"
              ? "Screen capture blocked"
              : "Capture failed";
        await showToast({
          style: Toast.Style.Failure,
          title,
          message: err.message,
        });
        return;
      }
      await showToast({
        style: Toast.Style.Failure,
        title: "Analysis failed",
        message: formatVisionError(err),
      });
    } finally {
      safeUnlink(outPath);
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Capture & Analyze" icon={Icon.Wand} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Requires Screen Recording for Raycast. Set the API key for the provider you pick in Vision model (OpenAI, Anthropic, or Google)." />
      <Form.Dropdown
        id="mode"
        title="Capture"
        defaultValue="interactive"
        info="Interactive and Window modes open macOS selection UI."
      >
        <Form.Dropdown.Item value="interactive" title="Interactive region" icon={Icon.Crop} />
        <Form.Dropdown.Item value="fullscreen" title="Full screen" icon={Icon.Desktop} />
        <Form.Dropdown.Item value="window" title="Single window" icon={Icon.Window} />
      </Form.Dropdown>
      <Form.TextArea
        id="prompt"
        title="Instructions for AI"
        placeholder={defaultPrompt}
        defaultValue={defaultPrompt}
        info="What you want the model to focus on (summary, OCR, errors, UI review, etc.)."
      />
    </Form>
  );
}
