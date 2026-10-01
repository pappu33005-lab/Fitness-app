import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { brandConfig } from "@vitacore/brand";
import { AppText, Button, Card, ErrorState, LoadingState, Screen, TextField } from "@/components/ui";
import { getSupabase, supabaseConfigStatus } from "@/auth/supabase";
import { recordEvent } from "@/data/logs";
import { copy } from "@/i18n/copy";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

const suggestions = [
  "What should I do today?",
  "How much protein should I target?",
  "Give me a high-protein meal under 500 kcal.",
];

type ChatTurn = { id: string; role: "user" | "assistant"; content: string };
type ConversationSummary = { id: string; createdAt: string; preview: string };

function replyFrom(data: unknown): { reply: string; conversationId: string | null } | null {
  if (!data || typeof data !== "object" || !("reply" in data)) return null;
  const reply = (data as { reply: unknown }).reply;
  if (typeof reply !== "string" || !reply.trim()) return null;
  const conversationId = "conversationId" in data && typeof (data as { conversationId: unknown }).conversationId === "string"
    ? (data as { conversationId: string }).conversationId
    : null;
  return { reply: reply.trim(), conversationId };
}

function errorFrom(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const error = (data as { error: unknown }).error;
  return typeof error === "string" && error.trim() ? error.trim() : null;
}

async function messageFromInvokeError(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        const text = errorFrom(body);
        if (text) return text;
      } catch {
        // The function body was not JSON. Fall through to the generic message.
      }
    }
  }
  return copy.coachUnavailable;
}

export default function CoachScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  const [configured, setConfigured] = useState<"unknown" | "unconfigured" | "signed_out" | "ready">("unknown");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

  useEffect(() => {
    if (supabaseConfigStatus() !== "ready") {
      setConfigured("unconfigured");
      return;
    }
    const client = getSupabase();
    if (!client) {
      setConfigured("unconfigured");
      return;
    }
    void client.auth.getSession().then(({ data }) => setConfigured(data.session ? "ready" : "signed_out"));
  }, []);

  function scrollToEnd() {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  async function loadHistory() {
    const client = getSupabase();
    if (!client) return;
    setHistoryBusy(true);
    const { data: conversations } = await client.from("ai_conversations").select("id, created_at").order("created_at", { ascending: false }).limit(20);
    const { data: firstMessages } = await client
      .from("ai_messages")
      .select("conversation_id, content, role, created_at")
      .eq("role", "user")
      .order("created_at", { ascending: true })
      .limit(400);
    const previewByConversation = new Map<string, string>();
    for (const row of firstMessages ?? []) {
      if (!previewByConversation.has(row.conversation_id)) previewByConversation.set(row.conversation_id, row.content);
    }
    setHistory(
      (conversations ?? []).map((conversation) => ({
        id: conversation.id,
        createdAt: conversation.created_at,
        preview: previewByConversation.get(conversation.id) ?? "New conversation",
      })),
    );
    setHistoryBusy(false);
  }

  async function openConversation(id: string) {
    const client = getSupabase();
    if (!client) return;
    setShowHistory(false);
    setError(null);
    setBusy(true);
    const { data: messages, error: loadError } = await client
      .from("ai_messages")
      .select("id, role, content")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setBusy(false);
    if (loadError || !messages) {
      setError("That conversation could not be opened. It may have been deleted.");
      return;
    }
    setConversationId(id);
    setThread(messages.map((row) => ({ id: row.id, role: row.role as "user" | "assistant", content: row.content })));
    scrollToEnd();
  }

  function startNewConversation() {
    setConversationId(null);
    setThread([]);
    setError(null);
    setFailedText(null);
    setShowHistory(false);
  }

  async function send(text: string) {
    if (configured === "unconfigured") {
      setError(copy.coachNotConfigured);
      return;
    }
    if (configured === "signed_out") {
      setError(copy.coachNeedsAccount);
      return;
    }
    const client = getSupabase();
    if (!client) {
      setError(copy.coachNotConfigured);
      return;
    }
    setError(null);
    setFailedText(null);
    const userTurn: ChatTurn = { id: `pending-${Date.now()}`, role: "user", content: text };
    setThread((current) => [...current, userTurn]);
    setMessage("");
    setBusy(true);
    scrollToEnd();
    await recordEvent("ai_interaction");
    const { data, error: invokeError } = await client.functions.invoke("ai-coach", {
      body: { message: text, conversationId: conversationId ?? undefined },
    });
    setBusy(false);
    const success = replyFrom(data);
    if (success) {
      setThread((current) => [...current, { id: `${userTurn.id}-reply`, role: "assistant", content: success.reply }]);
      if (success.conversationId) setConversationId(success.conversationId);
      scrollToEnd();
      return;
    }
    // The request failed: drop the optimistic user turn and offer Retry rather than showing an answer that was never given.
    setThread((current) => current.filter((turn) => turn.id !== userTurn.id));
    setFailedText(text);
    const bodyError = errorFrom(data);
    if (bodyError) {
      setError(bodyError);
      return;
    }
    if (invokeError) {
      setError(await messageFromInvokeError(invokeError));
      return;
    }
    setError(copy.coachUnavailable);
  }

  const usingRealData = thread.length > 0 || conversationId != null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
      <Screen
        scroll={false}
        footer={
          <View style={{ paddingHorizontal: space.xl, paddingBottom: space.lg, paddingTop: space.sm, gap: space.sm }}>
            {failedText ? (
              <Button label="Retry" tone="secondary" onPress={() => void send(failedText)} disabled={busy} />
            ) : null}
            <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
              <View style={{ flex: 1 }}>
                <TextField label="Ask" value={message} onChangeText={setMessage} placeholder="A training or food question" />
              </View>
              <Button label={busy ? "…" : "Send"} disabled={busy || message.trim().length === 0} onPress={() => void send(message.trim())} />
            </View>
          </View>
        }
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: space.sm }}>
          <Button label="Back" tone="ghost" onPress={() => router.back()} />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              label="History"
              tone="ghost"
              onPress={() => {
                const next = !showHistory;
                setShowHistory(next);
                if (next && history === null) void loadHistory();
              }}
            />
            <Button label="New" tone="ghost" onPress={startNewConversation} />
          </View>
        </View>
        <AppText variant="h1">Coach</AppText>
        <AppText variant="small" color={colors.textSecondary}>
          {brandConfig.name} answers from saved data. It does not invent steps, sleep, or meals, and it does not diagnose.
        </AppText>
        {usingRealData ? (
          <AppText variant="caption" color={colors.textSecondary}>
            Using your saved profile and recently synced data where available. Anything not recorded is stated as not recorded, not guessed.
          </AppText>
        ) : null}

        {showHistory ? (
          <Card>
            {historyBusy ? (
              <LoadingState label="Loading past conversations…" />
            ) : !history || history.length === 0 ? (
              <AppText variant="small" color={colors.textSecondary}>No past conversations yet.</AppText>
            ) : (
              history.map((item) => (
                <View key={item.id} style={{ paddingVertical: space.sm }}>
                  <Button label={item.preview.length > 60 ? `${item.preview.slice(0, 60)}…` : item.preview} tone="ghost" onPress={() => void openConversation(item.id)} />
                </View>
              ))
            )}
          </Card>
        ) : null}

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: space.md, gap: space.md }} showsVerticalScrollIndicator={false}>
          {thread.length === 0 && !busy ? (
            <View>
              <AppText variant="small" color={colors.textSecondary}>Try one of these, or ask your own question below.</AppText>
              <View style={{ height: space.sm }} />
              {suggestions.map((item) => (
                <View key={item} style={{ marginBottom: space.sm }}>
                  <Button label={item} tone="secondary" onPress={() => void send(item)} />
                </View>
              ))}
            </View>
          ) : null}
          {thread.map((turn) => (
            <View key={turn.id} style={{ alignSelf: turn.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
              <Card style={turn.role === "user" ? { backgroundColor: colors.accent } : undefined}>
                <AppText variant="body" color={turn.role === "user" ? colors.onAccent : colors.text}>{turn.content}</AppText>
              </Card>
            </View>
          ))}
          {busy ? <LoadingState label="The coach is thinking…" /> : null}
          {error ? <ErrorState title="This message did not go through" body={error} action={failedText ? { label: "Retry", onPress: () => void send(failedText) } : undefined} /> : null}
        </ScrollView>

        <AppText variant="caption">{copy.coachPrivacy}</AppText>
        <View style={{ height: space.xs }} />
        <AppText variant="caption">{copy.disclaimer}</AppText>
      </Screen>
    </KeyboardAvoidingView>
  );
}
