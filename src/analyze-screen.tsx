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
import { CaptureError, CaptureMode, captureToFile, safeUnlink } from "./capture";
import { analyzeImageWithOpenAI, formatOpenAIError } from "./openai-vision";

type FormValues = {
  mode: CaptureMode;
  prompt: string;
};

export default function AnalyzeScreenCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const defaultPrompt =
    prefs.defaultPrompt?.trim() ||
    "Describe what you see on the screen. Call out any text, UI elements, errors, or notable details.";

  async function handleSubmit(values: FormValues) {
    const apiKey = prefs.apiKey?.trim();
    if (!apiKey) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Missing API key",
        message: "Add your OpenAI API key in Raycast → Extensions → Screen AI → Preferences.",
      });
      return;
    }

    const model = prefs.model?.trim() || "gpt-4o-mini";
    const prompt = values.prompt?.trim() || defaultPrompt;
    const outPath = join(environment.supportPath, `screen-ai-${Date.now()}.png`);

    const loading = await showToast({
      style: Toast.Style.Animated,
      title: "Capturing screenshot…",
    });

    try {
      await captureToFile(values.mode, outPath);
      loading.title = "Analyzing with OpenAI…";

      const base64 = readFileSync(outPath, { encoding: "base64" });
      const answer = await analyzeImageWithOpenAI(apiKey, model, base64, prompt);

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
        message: formatOpenAIError(err),
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
      <Form.Description text="Requires Screen Recording permission for Raycast. Uses your OpenAI API key from preferences." />
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
