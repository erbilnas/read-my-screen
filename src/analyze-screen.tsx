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
import { pathToFileURL } from "node:url";
import { useCallback, useEffect, useState } from "react";
import { analyzeImage, formatVisionError } from "./analyze-image";
import { analyzeWebPageText, buildWebPageUserMessage } from "./analyze-text";
import { BrowserTabError, getActiveBrowserTab } from "./browser-tab";
import { ClipboardImageError, readImageFromClipboard } from "./clipboard-image";
import { CaptureError, CaptureMode, captureToFile, safeUnlink } from "./capture";
import { type ChatTurn, continueConversation, type SessionContext } from "./continue-chat";
import { FetchPageError, fetchPageAsPlainText } from "./fetch-page-text";
import { effectiveModelPreference, MODEL_PREFERENCE_OPTIONS, modelTitleForValue, parseModelPreference } from "./model";
import { regenerateLastTurn } from "./regenerate-turn";
import {
  BUILTIN_PROMPT_PRESETS,
  PRESET_PREF_DEFAULT,
  addCustomPreset,
  loadCustomPresets,
  promptForPresetValue,
  type CustomPromptPreset,
} from "./prompt-presets";
import {
  appendStoredSession,
  chatToMarkdown,
  deleteStoredSession,
  getSessionScreenImagePath,
  historyListPreview,
  loadStoredSessions,
  readSessionImageFile,
  type StoredSession,
} from "./stored-sessions";
import { formatUsageHint, type TokenUsage } from "./token-usage";
import { ReplyForm, SessionModelForm } from "./chat-forms";
import { EXTENSION_DISPLAY_NAME } from "./extension-brand";

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

function historyDetailMarkdown(s: StoredSession): string {
  const imgPath = getSessionScreenImagePath(s);
  const preview = historyListPreview(s);
  if (imgPath) {
    return `![Captured screen](${pathToFileURL(imgPath).href})\n\n_${preview}_`;
  }
  return preview;
}

/** Renders arbitrary text safely as markdown (fenced block). */
function userInstructionsMarkdown(body: string): string {
  const fence = body.includes("```") ? "````" : "```";
  return `### Message\n\n${fence}\n${body}\n${fence}`;
}

type SavePresetFormValues = { title: string };

function SavePresetForm({
  promptToSave,
  onSave,
}: {
  promptToSave: string;
  onSave: (title: string, prompt: string) => void;
}) {
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Preset"
            icon={Icon.Plus}
            onSubmit={(values: SavePresetFormValues) => {
              onSave(values.title ?? "", promptToSave);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Preset name" placeholder="e.g. Ticket description" />
    </Form>
  );
}

export default function AnalyzeScreenCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const { push, pop } = useNavigation();
  const defaultPrompt =
    prefs.defaultPrompt?.trim() ||
    "Describe what you see on the screen. Call out any text, UI elements, errors, or notable details.";

  const [phase, setPhase] = useState<"setup" | "chat" | "history">("setup");
  const [formKey, setFormKey] = useState(0);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [session, setSession] = useState<SessionContext | null>(null);
  const [contentSource, setContentSource] = useState<ContentSource>("screen");
  const [promptText, setPromptText] = useState(defaultPrompt);
  const [presetSelection, setPresetSelection] = useState(PRESET_PREF_DEFAULT);
  const [customPresets, setCustomPresets] = useState<CustomPromptPreset[]>([]);
  const [historySessions, setHistorySessions] = useState<StoredSession[]>([]);
  const [lastRequestUsage, setLastRequestUsage] = useState<TokenUsage | null>(null);
  /** Full `provider:modelId` string for the current thread (follow-ups and regenerate). */
  const [sessionModel, setSessionModel] = useState("");
  /** Setup form only: empty means use extension default from preferences. */
  const [setupModelOverride, setSetupModelOverride] = useState("");
  const showTokenUsagePref = prefs.showTokenUsage === true;

  const effectiveSessionModel = sessionModel.trim() || prefs.model?.trim() || "openai:gpt-4o-mini";

  useEffect(() => {
    void loadCustomPresets().then(setCustomPresets);
  }, []);

  useEffect(() => {
    if (presetSelection === PRESET_PREF_DEFAULT) {
      setPromptText(defaultPrompt);
    }
  }, [defaultPrompt, presetSelection]);

  useEffect(() => {
    if (phase === "history") {
      void loadStoredSessions().then(setHistorySessions);
    }
  }, [phase]);

  const startOver = useCallback(() => {
    setMessages([]);
    setSession(null);
    setPhase("setup");
    setPromptText(defaultPrompt);
    setPresetSelection(PRESET_PREF_DEFAULT);
    setLastRequestUsage(null);
    setSessionModel("");
    setSetupModelOverride("");
    setFormKey((k) => k + 1);
  }, [defaultPrompt]);

  const sendFollowUp = useCallback(
    async (followUpRaw: string) => {
      const followUp = followUpRaw.trim();
      if (!followUp || !session) {
        return;
      }

      const parsed = parseModelPreference(effectiveSessionModel);
      const thread: ChatTurn[] = [...messages, { role: "user", content: followUp }];

      const loading = await showToast({
        style: Toast.Style.Animated,
        title: "Waiting for reply…",
      });

      try {
        const { text: reply, usage } = await continueConversation(prefs, parsed, session, thread);
        setMessages([...thread, { role: "assistant", content: reply }]);
        setLastRequestUsage(usage ?? null);
        await Clipboard.copy(reply);
        loading.hide();
        await showToast({
          style: Toast.Style.Success,
          title: "Reply ready",
          message: `Copied to clipboard.${formatUsageHint(usage, showTokenUsagePref)}`,
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
    [messages, prefs, session, showTokenUsagePref, effectiveSessionModel],
  );

  const runRegenerate = useCallback(async () => {
    if (!session || messages.length < 2) {
      return;
    }
    const loading = await showToast({
      style: Toast.Style.Animated,
      title: "Regenerating…",
    });
    try {
      const { messages: next, usage } = await regenerateLastTurn(prefs, effectiveSessionModel, messages, session);
      setMessages(next);
      setLastRequestUsage(usage);
      const last = [...next].reverse().find((m) => m.role === "assistant");
      if (last) {
        await Clipboard.copy(last.content);
      }
      loading.hide();
      await showToast({
        style: Toast.Style.Success,
        title: "Regenerated",
        message: `Copied to clipboard.${formatUsageHint(usage ?? undefined, showTokenUsagePref)}`,
      });
    } catch (err) {
      loading.hide();
      await showToast({
        style: Toast.Style.Failure,
        title: "Regenerate failed",
        message: formatVisionError(err),
      });
    }
  }, [messages, prefs, session, showTokenUsagePref, effectiveSessionModel]);

  const openSessionModelPicker = useCallback(() => {
    push(
      <SessionModelForm
        initialModel={effectiveSessionModel}
        onSubmit={(model) => {
          pop();
          setSessionModel(model.trim());
          void showToast({ style: Toast.Style.Success, title: "Model updated for this chat" });
        }}
      />,
    );
  }, [effectiveSessionModel, pop, push]);

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

  const copyConversationMarkdown = useCallback(async () => {
    await Clipboard.copy(chatToMarkdown(messages));
    await showToast({
      style: Toast.Style.Success,
      title: "Copied",
      message: "Full conversation as Markdown.",
    });
  }, [messages]);

  const restoreFromHistory = useCallback(
    (record: StoredSession) => {
      setLastRequestUsage(null);
      setSessionModel(prefs.model?.trim() || "openai:gpt-4o-mini");
      if (record.source === "browser") {
        setMessages(record.messages);
        setSession({ source: "browser" });
        setPhase("chat");
        return;
      }
      const img = readSessionImageFile(record);
      if (!img) {
        void showToast({
          style: Toast.Style.Failure,
          title: "Image missing",
          message: "The saved screen image could not be loaded.",
        });
        return;
      }
      setMessages(record.messages);
      setSession({
        source: "screen",
        screenBase64: img.base64,
        screenMediaType: img.mediaType,
      });
      setPhase("chat");
    },
    [prefs.model],
  );

  const handleDeleteHistory = useCallback(async (id: string) => {
    await deleteStoredSession(id);
    setHistorySessions(await loadStoredSessions());
  }, []);

  async function handleSubmit(values: FormValues) {
    const effectiveSm = effectiveModelPreference(prefs.model, setupModelOverride);
    const parsed = parseModelPreference(effectiveSm);

    const prompt = promptText.trim() || defaultPrompt;
    const source = (values.contentSource as ContentSource) ?? contentSource;

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
        const { text: answer, usage } = await analyzeWebPageText(prefs, parsed, prompt, tab, pageText);
        const userDisplay = buildWebPageUserMessage(prompt, tab, pageText);
        const thread: ChatTurn[] = [
          { role: "user", content: userDisplay },
          { role: "assistant", content: answer },
        ];
        setMessages(thread);
        setSession({ source: "browser" });
        setSessionModel(effectiveSm);
        setLastRequestUsage(usage ?? null);
        setPhase("chat");
        loading.hide();
        await Clipboard.copy(answer);
        void appendStoredSession({
          title: previewText(userDisplay, 100),
          source: "browser",
          messages: thread,
        }).catch(() => {
          /* ignore persistence errors */
        });
        await showToast({
          style: Toast.Style.Success,
          title: "Response ready",
          message: `Copied to clipboard. Use Continue chat for follow-ups.${formatUsageHint(usage, showTokenUsagePref)}`,
        });
        return;
      }

      let base64: string;
      let mediaType = "image/png";

      if (values.mode === "clipboard") {
        loading.title = "Reading clipboard…";
        const img = await readImageFromClipboard();
        base64 = img.base64;
        mediaType = img.mediaType;
      } else {
        outPath = join(environment.supportPath, `read-my-screen-${Date.now()}.png`);
        loading.title = "Capturing screenshot…";
        await captureToFile(values.mode, outPath);
        base64 = readFileSync(outPath, { encoding: "base64" });
      }

      loading.title = analyzingLabel(parsed);
      const { text: answer, usage } = await analyzeImage(prefs, parsed, base64, prompt, mediaType);

      const thread: ChatTurn[] = [
        { role: "user", content: prompt },
        { role: "assistant", content: answer },
      ];
      setMessages(thread);
      setSession({ source: "screen", screenBase64: base64, screenMediaType: mediaType });
      setSessionModel(effectiveSm);
      setLastRequestUsage(usage ?? null);
      setPhase("chat");
      loading.hide();
      await Clipboard.copy(answer);
      void appendStoredSession({
        title: previewText(prompt, 100),
        source: "screen",
        messages: thread,
        screenBase64: base64,
        screenMediaType: mediaType,
      }).catch(() => {
        /* ignore persistence errors */
      });
      await showToast({
        style: Toast.Style.Success,
        title: "Response ready",
        message: `Copied to clipboard. Use Continue chat for follow-ups.${formatUsageHint(usage, showTokenUsagePref)}`,
      });
    } catch (err) {
      loading.hide();
      if (err instanceof ClipboardImageError) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Clipboard",
          message: err.message,
        });
        return;
      }
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

  if (phase === "history") {
    return (
      <List
        navigationTitle="Session history"
        searchBarPlaceholder="Search sessions"
        isShowingDetail
        actions={
          <ActionPanel>
            <Action title="Back" icon={Icon.ArrowLeft} onAction={() => setPhase("setup")} />
          </ActionPanel>
        }
      >
        <List.Section title="Recent" subtitle={`${historySessions.length} saved`}>
          {historySessions.map((s) => (
            <List.Item
              key={s.id}
              id={s.id}
              icon={s.source === "browser" ? Icon.Globe : Icon.Image}
              title={s.title}
              subtitle={historyListPreview(s)}
              detail={<List.Item.Detail markdown={historyDetailMarkdown(s)} />}
              accessories={[
                { text: new Date(s.createdAt).toLocaleString() },
                { text: s.source === "browser" ? "Browser" : "Screen" },
              ]}
              actions={
                <ActionPanel>
                  <Action title="Open" icon={Icon.ArrowRight} onAction={() => restoreFromHistory(s)} />
                  <Action
                    title="Delete"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={() => void handleDeleteHistory(s.id)}
                  />
                  <Action title="Back" icon={Icon.ArrowLeft} onAction={() => setPhase("setup")} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      </List>
    );
  }

  if (phase === "chat" && messages.length > 0 && session) {
    const lastIdx = messages.length - 1;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

    return (
      <List
        navigationTitle={EXTENSION_DISPLAY_NAME}
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
            <Action
              title="Copy Conversation as Markdown"
              icon={Icon.Document}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              onAction={() => void copyConversationMarkdown()}
            />
            <Action title="New Analysis" icon={Icon.Rewind} onAction={startOver} />
            <Action
              title="Regenerate Last Reply"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={() => void runRegenerate()}
            />
            <Action title="Change Model for This Chat" icon={Icon.Gear} onAction={openSessionModelPicker} />
            {lastAssistant ? <Action.CopyToClipboard title="Copy Last Reply" content={lastAssistant.content} /> : null}
          </ActionPanel>
        }
      >
        <List.Section
          title="Conversation"
          subtitle={`${modelTitleForValue(effectiveSessionModel)} · ${messages.length} messages${formatUsageHint(lastRequestUsage ?? undefined, showTokenUsagePref)}`}
        >
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
                  <Action
                    title="Regenerate Last Reply"
                    icon={Icon.ArrowClockwise}
                    onAction={() => void runRegenerate()}
                  />
                  <Action title="Change Model for This Chat" icon={Icon.Gear} onAction={openSessionModelPicker} />
                  <Action
                    title="Copy Conversation as Markdown"
                    icon={Icon.Document}
                    onAction={() => void copyConversationMarkdown()}
                  />
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
          <Action title="Session History" icon={Icon.Clock} onAction={() => setPhase("history")} />
          <Action
            title="Save Instructions as Preset"
            icon={Icon.Plus}
            onAction={() =>
              push(
                <SavePresetForm
                  promptToSave={promptText}
                  onSave={async (title, prompt) => {
                    const trimmed = title.trim();
                    if (!trimmed) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "Name required",
                        message: "Enter a name for this preset.",
                      });
                      return;
                    }
                    const before = customPresets.length;
                    const next = await addCustomPreset(trimmed, prompt);
                    setCustomPresets(next);
                    if (next.length > before) {
                      const last = next[next.length - 1];
                      setPresetSelection(`custom:${last.id}`);
                      setPromptText(last.prompt);
                      pop();
                      await showToast({ style: Toast.Style.Success, title: "Preset saved" });
                    } else {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "Could not save",
                        message: "Instructions cannot be empty.",
                      });
                    }
                  }}
                />,
              )
            }
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Set API keys for the model provider in Read My Screen preferences. Screen capture needs Screen Recording permission for Raycast." />
      <Form.Dropdown
        id="modelForRun"
        title="Model"
        value={setupModelOverride}
        onChange={setSetupModelOverride}
        info="Overrides the extension default model for this run only. Follow-ups and regenerate use the same model until you change it in chat."
      >
        <Form.Dropdown.Item value="" title="Default (from preferences)" icon={Icon.Star} />
        {MODEL_PREFERENCE_OPTIONS.map((opt) => (
          <Form.Dropdown.Item key={opt.value} value={opt.value} title={opt.title} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="contentSource"
        title="Content source"
        defaultValue="screen"
        onChange={(v) => setContentSource(v as ContentSource)}
      >
        <Form.Dropdown.Item value="screen" title="Screen capture" icon={Icon.Desktop} />
        <Form.Dropdown.Item value="browser" title="Current browser page" icon={Icon.Globe} />
      </Form.Dropdown>
      <Form.Dropdown
        id="promptPreset"
        title="Instruction preset"
        value={presetSelection}
        onChange={(v) => {
          const next = v || PRESET_PREF_DEFAULT;
          setPresetSelection(next);
          const resolved = promptForPresetValue(next, defaultPrompt, customPresets);
          if (resolved !== undefined) {
            setPromptText(resolved);
          }
        }}
      >
        <Form.Dropdown.Item value={PRESET_PREF_DEFAULT} title="Default (from preferences)" icon={Icon.Star} />
        {BUILTIN_PROMPT_PRESETS.map((b) => (
          <Form.Dropdown.Item key={b.id} value={`builtin:${b.id}`} title={b.title} icon={Icon.Text} />
        ))}
        {customPresets.map((c) => (
          <Form.Dropdown.Item key={c.id} value={`custom:${c.id}`} title={c.title} icon={Icon.StarCircle} />
        ))}
      </Form.Dropdown>
      {contentSource === "screen" ? (
        <Form.Dropdown
          id="mode"
          title="Capture"
          defaultValue="interactive"
          info="Interactive and Window modes open macOS selection UI. Clipboard uses a file-backed image from the clipboard."
        >
          <Form.Dropdown.Item value="interactive" title="Interactive region" icon={Icon.Crop} />
          <Form.Dropdown.Item value="fullscreen" title="Full screen" icon={Icon.Desktop} />
          <Form.Dropdown.Item value="window" title="Single window" icon={Icon.Window} />
          <Form.Dropdown.Item value="clipboard" title="Clipboard image (file)" icon={Icon.Clipboard} />
        </Form.Dropdown>
      ) : (
        <Form.Description text="Uses AppleScript to read the active tab from Chrome, Safari, Arc, Dia, Brave, Edge, Opera, or Vivaldi (first browser with an open window). The page is fetched and converted to plain text—SPA or login-only content may not match what you see on screen." />
      )}
      <Form.TextArea
        id="prompt"
        title="Instructions for AI"
        placeholder={defaultPrompt}
        value={promptText}
        onChange={setPromptText}
        info="What you want the model to focus on (summary, OCR, errors, UI review, page outline, etc.)."
      />
    </Form>
  );
}
