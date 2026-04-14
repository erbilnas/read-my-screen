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
  useNavigation,
} from "@raycast/api";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useCallback, useState } from "react";
import { analyzeImage, formatVisionError } from "./analyze-image";
import { analyzeWebPageText, buildWebPageUserMessage } from "./analyze-text";
import { BrowserTabError, getActiveBrowserTab } from "./browser-tab";
import { CaptureError, CaptureMode, captureToFile, safeUnlink } from "./capture";
import { type ChatTurn, continueConversation, type SessionContext } from "./continue-chat";
import { FetchPageError, fetchPageAsPlainText } from "./fetch-page-text";
import { parseModelPreference } from "./model";

type ContentSource = "screen" | "browser";

type FormValues = {
  contentSource: ContentSource;
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

function previewText(text: string, max = 120): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Renders arbitrary text safely as markdown (fenced block). */
function userInstructionsMarkdown(body: string): string {
  const fence = body.includes("```") ? "````" : "```";
  return `### Message\n\n${fence}\n${body}\n${fence}`;
}

type ReplyFormValues = { reply: string };

function ReplyForm({ onSubmit }: { onSubmit: (text: string) => void }) {
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send"
            icon={Icon.ArrowRight}
            onSubmit={(values: ReplyFormValues) => {
              onSubmit(values.reply ?? "");
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea id="reply" title="Follow-up" placeholder="Ask a follow-up question…" />
    </Form>
  );
}

export default function AnalyzeScreenCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const { push, pop } = useNavigation();
  const defaultPrompt =
    prefs.defaultPrompt?.trim() ||
    "Describe what you see on the screen. Call out any text, UI elements, errors, or notable details.";

  const [phase, setPhase] = useState<"setup" | "chat">("setup");
  const [formKey, setFormKey] = useState(0);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [session, setSession] = useState<SessionContext | null>(null);
  const [contentSource, setContentSource] = useState<ContentSource>("screen");

  const startOver = useCallback(() => {
    setMessages([]);
    setSession(null);
    setPhase("setup");
    setFormKey((k) => k + 1);
  }, []);

  const sendFollowUp = useCallback(
    async (followUpRaw: string) => {
      const followUp = followUpRaw.trim();
      if (!followUp || !session) {
        return;
      }

      const modelPref = prefs.model?.trim() || "openai:gpt-4o-mini";
      const parsed = parseModelPreference(modelPref);
      const thread: ChatTurn[] = [...messages, { role: "user", content: followUp }];

      const loading = await showToast({
        style: Toast.Style.Animated,
        title: "Waiting for reply…",
      });

      try {
        const reply = await continueConversation(prefs, parsed, session, thread);
        setMessages([...thread, { role: "assistant", content: reply }]);
        await Clipboard.copy(reply);
        loading.hide();
        await showToast({
          style: Toast.Style.Success,
          title: "Reply ready",
          message: "Copied to clipboard.",
        });
      } catch (err) {
        loading.hide();
        await showToast({
          style: Toast.Style.Failure,
          title: "Message failed",
          message: formatVisionError(err),
        });
      }
    },
    [messages, prefs, session],
  );

  const openReply = useCallback(() => {
    push(
      <ReplyForm
        onSubmit={(text) => {
          pop();
          void sendFollowUp(text);
        }}
      />,
    );
  }, [pop, push, sendFollowUp]);

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
        setSession({ source: "browser" });
        setPhase("chat");
        loading.hide();
        await Clipboard.copy(answer);
        await showToast({
          style: Toast.Style.Success,
          title: "Response ready",
          message: "Copied to clipboard. Use Continue chat for follow-ups.",
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
      setSession({ source: "screen", screenBase64: base64 });
      setPhase("chat");
      loading.hide();
      await Clipboard.copy(answer);
      await showToast({
        style: Toast.Style.Success,
        title: "Response ready",
        message: "Copied to clipboard. Use Continue chat for follow-ups.",
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

  if (phase === "chat" && messages.length > 0 && session) {
    const lastIdx = messages.length - 1;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

    return (
      <List
        navigationTitle="Screen AI"
        searchBarPlaceholder="Search in this chat"
        isShowingDetail
        selectedItemId={`msg-${lastIdx}`}
        actions={
          <ActionPanel>
            <Action
              title="Continue Chat"
              icon={Icon.Message}
              shortcut={{ modifiers: ["cmd"], key: "n" }}
              onAction={openReply}
            />
            <Action title="New Analysis" icon={Icon.Rewind} onAction={startOver} />
            {lastAssistant ? <Action.CopyToClipboard title="Copy Last Reply" content={lastAssistant.content} /> : null}
          </ActionPanel>
        }
      >
        <List.Section title="Conversation" subtitle={`${messages.length} messages`}>
          {messages.map((m, i) => (
            <List.Item
              key={`msg-${i}`}
              id={`msg-${i}`}
              icon={
                m.role === "user"
                  ? { source: Icon.Person, tintColor: Color.Blue }
                  : { source: Icon.Stars, tintColor: Color.Purple }
              }
              title={m.role === "user" ? "You" : "Assistant"}
              subtitle={previewText(m.content)}
              detail={
                <List.Item.Detail markdown={m.role === "user" ? userInstructionsMarkdown(m.content) : m.content} />
              }
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title={m.role === "user" ? "Copy Message" : "Copy Reply"}
                    content={m.content}
                  />
                  <Action title="Continue Chat" icon={Icon.Message} onAction={openReply} />
                  <Action title="New Analysis" icon={Icon.Rewind} onAction={startOver} />
                </ActionPanel>
              }
            />
          ))}
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
