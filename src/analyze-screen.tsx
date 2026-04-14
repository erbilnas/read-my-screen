import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Form,
  Icon,
  List,
  Toast,
  environment,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useCallback, useState } from "react";
import { analyzeImage, formatVisionError } from "./analyze-image";
import { analyzeWebPageText, buildWebPageUserMessage } from "./analyze-text";
import { BrowserTabError, getActiveBrowserTab } from "./browser-tab";
import { CaptureError, CaptureMode, captureToFile, safeUnlink } from "./capture";
import { FetchPageError, fetchPageAsPlainText } from "./fetch-page-text";
import { parseModelPreference } from "./model";

type ContentSource = "screen" | "browser";

type FormValues = {
  contentSource: ContentSource;
  mode: CaptureMode;
  prompt: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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

function previewText(text: string, max = 120): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Renders arbitrary text safely as markdown (fenced block). */
function userInstructionsMarkdown(body: string): string {
  const fence = body.includes("```") ? "````" : "```";
  return `### Your instructions\n\n${fence}\n${body}\n${fence}`;
}

export default function AnalyzeScreenCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const defaultPrompt =
    prefs.defaultPrompt?.trim() ||
    "Describe what you see on the screen. Call out any text, UI elements, errors, or notable details.";

  const [phase, setPhase] = useState<"setup" | "chat">("setup");
  const [formKey, setFormKey] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contentSource, setContentSource] = useState<ContentSource>("screen");

  const startOver = useCallback(() => {
    setMessages([]);
    setPhase("setup");
    setFormKey((k) => k + 1);
  }, []);

  async function handleSubmit(values: FormValues) {
    const modelPref = prefs.model?.trim() || "openai:gpt-4o-mini";
    const parsed = parseModelPreference(modelPref);

    const prompt = values.prompt?.trim() || defaultPrompt;
    const source = values.contentSource ?? "screen";

    const loading = await showToast({
      style: Toast.Style.Animated,
      title: source === "browser" ? "Reading browser tab…" : "Capturing screenshot…",
    });

    let outPath: string | null = null;

    try {
      if (source === "browser") {
        const tab = await getActiveBrowserTab();
        loading.title = "Loading page…";
        const pageText = await fetchPageAsPlainText(tab.url);
        loading.title = analyzingLabel(parsed);
        const answer = await analyzeWebPageText(prefs, parsed, prompt, tab, pageText);
        const userDisplay = buildWebPageUserMessage(prompt, tab, pageText);
        setMessages([
          { role: "user", content: userDisplay },
          { role: "assistant", content: answer },
        ]);
        setPhase("chat");
        loading.hide();
        await Clipboard.copy(answer);
        await showToast({
          style: Toast.Style.Success,
          title: "Response ready",
          message: "Copied to clipboard. Open the list items to read the full reply.",
        });
        return;
      }

      outPath = join(environment.supportPath, `screen-ai-${Date.now()}.png`);
      loading.title = "Capturing screenshot…";
      await captureToFile(values.mode, outPath);
      loading.title = analyzingLabel(parsed);

      const base64 = readFileSync(outPath, { encoding: "base64" });
      const answer = await analyzeImage(prefs, parsed, base64, prompt);

      setMessages([
        { role: "user", content: prompt },
        { role: "assistant", content: answer },
      ]);
      setPhase("chat");
      loading.hide();
      await Clipboard.copy(answer);
      await showToast({
        style: Toast.Style.Success,
        title: "Response ready",
        message: "Copied to clipboard. Open the list items to read the full reply.",
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
      if (err instanceof BrowserTabError) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Browser tab",
          message: err.message,
        });
        return;
      }
      if (err instanceof FetchPageError) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not load page",
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
      if (outPath) {
        safeUnlink(outPath);
      }
    }
  }

  if (phase === "chat" && messages.length > 0) {
    const userMsg = messages.find((m) => m.role === "user");
    const assistantMsg = messages.find((m) => m.role === "assistant");

    return (
      <List
        navigationTitle="Screen AI"
        searchBarPlaceholder="Search in this chat"
        isShowingDetail
        selectedItemId="assistant"
        actions={
          <ActionPanel>
            <Action title="New Analysis" icon={Icon.Rewind} onAction={startOver} />
            {assistantMsg ? (
              <Action.CopyToClipboard title="Copy Assistant Reply" content={assistantMsg.content} />
            ) : null}
          </ActionPanel>
        }
      >
        <List.Section title="Chat" subtitle="Your request and the model reply">
          {userMsg ? (
            <List.Item
              id="user"
              icon={{ source: Icon.Person, tintColor: Color.Blue }}
              title="You"
              subtitle={previewText(userMsg.content)}
              detail={<List.Item.Detail markdown={userInstructionsMarkdown(userMsg.content)} />}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title="Copy Request" content={userMsg.content} />
                  <Action title="New Analysis" icon={Icon.Rewind} onAction={startOver} />
                </ActionPanel>
              }
            />
          ) : null}
          {assistantMsg ? (
            <List.Item
              id="assistant"
              icon={{ source: Icon.Stars, tintColor: Color.Purple }}
              title="Assistant"
              subtitle={previewText(assistantMsg.content)}
              detail={<List.Item.Detail markdown={assistantMsg.content} />}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard title="Copy Reply" content={assistantMsg.content} />
                  <Action title="New Analysis" icon={Icon.Rewind} onAction={startOver} />
                </ActionPanel>
              }
            />
          ) : null}
        </List.Section>
      </List>
    );
  }

  return (
    <Form
      key={formKey}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Run Analysis" icon={Icon.Wand} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Set API keys for the model provider in extension preferences. Screen capture needs Screen Recording for Raycast." />
      <Form.Dropdown
        id="contentSource"
        title="Content source"
        defaultValue="screen"
        onChange={(v) => setContentSource(v as ContentSource)}
      >
        <Form.Dropdown.Item value="screen" title="Screen capture" icon={Icon.Desktop} />
        <Form.Dropdown.Item value="browser" title="Current browser page" icon={Icon.Globe} />
      </Form.Dropdown>
      {contentSource === "screen" ? (
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
      ) : (
        <Form.Description text="Uses AppleScript to read the active tab from Chrome, Safari, Arc, Brave, Edge, Opera, or Vivaldi (first browser with an open window). The page is fetched and converted to plain text—SPA or login-only content may not match what you see on screen." />
      )}
      <Form.TextArea
        id="prompt"
        title="Instructions for AI"
        placeholder={defaultPrompt}
        defaultValue={defaultPrompt}
        info="What you want the model to focus on (summary, OCR, errors, UI review, page outline, etc.)."
      />
    </Form>
  );
}
