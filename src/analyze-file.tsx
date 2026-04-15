import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Form,
  Icon,
  List,
  Toast,
  getPreferenceValues,
  showToast,
  useNavigation,
} from "@raycast/api";
import { readFileSync } from "node:fs";
import { useCallback, useEffect, useState } from "react";
import { analyzeImage, formatVisionError } from "./analyze-image";
import { ReplyForm, SessionModelForm } from "./chat-forms";
import { mimeTypeForImagePath } from "./clipboard-image";
import {
  BUILTIN_PROMPT_PRESETS,
  PRESET_PREF_DEFAULT,
  addCustomPreset,
  loadCustomPresets,
  promptForPresetValue,
  type CustomPromptPreset,
} from "./prompt-presets";
import { type ChatTurn, continueConversation, type SessionContext } from "./continue-chat";
import { effectiveModelPreference, MODEL_PREFERENCE_OPTIONS, modelTitleForValue, parseModelPreference } from "./model";
import { regenerateLastTurn } from "./regenerate-turn";
import { appendStoredSession, chatToMarkdown } from "./stored-sessions";
import { formatUsageHint, type TokenUsage } from "./token-usage";

function previewText(text: string, max = 120): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

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

type FormValues = {
  imageFile: string[];
  prompt: string;
};

export default function AnalyzeFileCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const { push, pop } = useNavigation();
  const defaultPrompt =
    prefs.defaultPrompt?.trim() ||
    "Describe what you see on the screen. Call out any text, UI elements, errors, or notable details.";

  const [phase, setPhase] = useState<"setup" | "chat">("setup");
  const [formKey, setFormKey] = useState(0);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [session, setSession] = useState<SessionContext | null>(null);
  const [promptText, setPromptText] = useState(defaultPrompt);
  const [presetSelection, setPresetSelection] = useState(PRESET_PREF_DEFAULT);
  const [customPresets, setCustomPresets] = useState<CustomPromptPreset[]>([]);
  const [pickedFiles, setPickedFiles] = useState<string[]>([]);
  const [setupModelOverride, setSetupModelOverride] = useState("");
  const [sessionModel, setSessionModel] = useState("");
  const [lastRequestUsage, setLastRequestUsage] = useState<TokenUsage | null>(null);
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

  const startOver = useCallback(() => {
    setMessages([]);
    setSession(null);
    setPhase("setup");
    setPromptText(defaultPrompt);
    setPresetSelection(PRESET_PREF_DEFAULT);
    setLastRequestUsage(null);
    setSessionModel("");
    setSetupModelOverride("");
    setPickedFiles([]);
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

  async function handleSubmit(values: FormValues) {
    const path = values.imageFile?.[0]?.trim() ?? pickedFiles[0]?.trim();
    if (!path) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Image required",
        message: "Choose an image file (PNG, JPEG, WebP, or GIF).",
      });
      return;
    }

    const mediaType = mimeTypeForImagePath(path);
    if (!mediaType) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Unsupported file",
        message: "Use PNG, JPEG, WebP, or GIF.",
      });
      return;
    }

    const effectiveSm = effectiveModelPreference(prefs.model, setupModelOverride);
    const parsed = parseModelPreference(effectiveSm);
    const prompt = promptText.trim() || defaultPrompt;

    const loading = await showToast({
      style: Toast.Style.Animated,
      title: "Reading file…",
    });

    try {
      const buf = readFileSync(path);
      if (!buf.length) {
        loading.hide();
        await showToast({ style: Toast.Style.Failure, title: "Empty file", message: "The image file is empty." });
        return;
      }
      const base64 = buf.toString("base64");
      loading.title = "Analyzing…";
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
        /* ignore */
      });
      await showToast({
        style: Toast.Style.Success,
        title: "Response ready",
        message: `Copied to clipboard. Use Continue chat for follow-ups.${formatUsageHint(usage, showTokenUsagePref)}`,
      });
    } catch (err) {
      loading.hide();
      await showToast({
        style: Toast.Style.Failure,
        title: "Analysis failed",
        message: formatVisionError(err),
      });
    }
  }

  if (phase === "chat" && messages.length > 0 && session) {
    const lastIdx = messages.length - 1;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

    return (
      <List
        navigationTitle="Screen AI · File"
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
      <Form.Description text="Choose a local image file. API keys and default model are set in extension preferences." />
      <Form.Dropdown
        id="modelForRun"
        title="Model"
        value={setupModelOverride}
        onChange={setSetupModelOverride}
        info="Overrides the extension default for this run. Follow-ups use the same model until you change it in chat."
      >
        <Form.Dropdown.Item value="" title="Default (from preferences)" icon={Icon.Star} />
        {MODEL_PREFERENCE_OPTIONS.map((opt) => (
          <Form.Dropdown.Item key={opt.value} value={opt.value} title={opt.title} />
        ))}
      </Form.Dropdown>
      <Form.FilePicker
        id="imageFile"
        title="Image file"
        value={pickedFiles}
        onChange={setPickedFiles}
        allowMultipleSelection={false}
        canChooseDirectories={false}
        info="PNG, JPEG, WebP, or GIF."
      />
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
      <Form.TextArea
        id="prompt"
        title="Instructions for AI"
        placeholder={defaultPrompt}
        value={promptText}
        onChange={setPromptText}
      />
    </Form>
  );
}
