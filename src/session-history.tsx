import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Icon,
  List,
  Toast,
  getPreferenceValues,
  showToast,
  useNavigation,
} from "@raycast/api";
import { pathToFileURL } from "node:url";
import { useCallback, useEffect, useState } from "react";
import { formatVisionError } from "./analyze-image";
import { ReplyForm, SessionModelForm } from "./chat-forms";
import { type ChatTurn, continueConversation, type SessionContext } from "./continue-chat";
import { modelTitleForValue, parseModelPreference } from "./model";
import { regenerateLastTurn } from "./regenerate-turn";
import {
  chatToMarkdown,
  deleteStoredSession,
  getSessionScreenImagePath,
  historyListPreview,
  loadStoredSessions,
  readSessionImageFile,
  type StoredSession,
} from "./stored-sessions";
import { formatUsageHint, type TokenUsage } from "./token-usage";
import { EXTENSION_DISPLAY_NAME } from "./extension-brand";

function previewText(text: string, max = 120): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function userInstructionsMarkdown(body: string): string {
  const fence = body.includes("```") ? "````" : "```";
  return `### Message\n\n${fence}\n${body}\n${fence}`;
}

function historyDetailMarkdown(s: StoredSession): string {
  const imgPath = getSessionScreenImagePath(s);
  const preview = historyListPreview(s);
  if (imgPath) {
    return `![Captured screen](${pathToFileURL(imgPath).href})\n\n_${preview}_`;
  }
  return preview;
}

export default function SessionHistoryCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const { push, pop } = useNavigation();
  const showTokenUsagePref = prefs.showTokenUsage === true;

  const [phase, setPhase] = useState<"list" | "chat">("list");
  const [historySessions, setHistorySessions] = useState<StoredSession[]>([]);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [session, setSession] = useState<SessionContext | null>(null);
  const [sessionModel, setSessionModel] = useState("");
  const [lastRequestUsage, setLastRequestUsage] = useState<TokenUsage | null>(null);

  const effectiveSessionModel = sessionModel.trim() || prefs.model?.trim() || "openai:gpt-4o-mini";

  useEffect(() => {
    void loadStoredSessions().then(setHistorySessions);
  }, []);

  const refreshList = useCallback(async () => {
    setHistorySessions(await loadStoredSessions());
  }, []);

  const backToList = useCallback(() => {
    setPhase("list");
    setMessages([]);
    setSession(null);
    setSessionModel("");
    setLastRequestUsage(null);
    void refreshList();
  }, [refreshList]);

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

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      await deleteStoredSession(id);
      await refreshList();
    },
    [refreshList],
  );

  if (phase === "chat" && messages.length > 0 && session) {
    const lastIdx = messages.length - 1;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

    return (
      <List
        navigationTitle={`${EXTENSION_DISPLAY_NAME} · Session`}
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
            <Action title="Back to History" icon={Icon.ArrowLeft} onAction={backToList} />
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
                  <Action title="Back to History" icon={Icon.ArrowLeft} onAction={backToList} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      </List>
    );
  }

  return (
    <List navigationTitle="Session history" searchBarPlaceholder="Search sessions" isShowingDetail>
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
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
