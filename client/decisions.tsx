import { useRpc, useWorkspace, usePaseo, type PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { answerDecision, listDecisions } from "../shared/decisions";
import { formatAge, NOT_INSTALLED, type LedgerItem } from "../shared/ledger";
import { queueKey, waitingQueue, type QueueAgent } from "../shared/queue";
import { readAllAgents } from "./directory";

export const DECISIONS_SCREEN_ID = "decisions";
const REFRESH_MS = 5_000;
const CHIP_CHARS = 12;
const MAX_CARD_WIDTH = 760;

/** Ledger questions from the daemon. The screen polls at 5 s; the sidebar row polls slower. */
export function useLedger(hostId: string, intervalMs: number) {
  const list = useRpc(listDecisions);
  return useQuery({
    queryKey: ["questions-please", "ledger", hostId],
    queryFn: () => list({}),
    refetchInterval: intervalMs,
    retry: false,
    staleTime: 1_000,
  });
}

type Colors = PluginScreenProps["theme"]["colors"];
interface CardProps {
  colors: Colors;
  compact: boolean;
}

interface Answering {
  busy: boolean;
  ok: boolean;
  message: string;
}
type Results = Record<string, Answering>;
type PickState = number | null;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Chip({ colors, text }: { colors: Colors; text: string }) {
  if (!text) return null;
  return (
    <View
      style={{
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{clip(text, CHIP_CHARS)}</Text>
    </View>
  );
}

function cardStyle({ colors, compact }: CardProps) {
  return {
    gap: 10,
    padding: compact ? 12 : 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
    width: "100%" as const,
    maxWidth: MAX_CARD_WIDTH,
  };
}

function Button({
  colors,
  label,
  onPress,
  primary,
  disabled,
}: {
  colors: Colors;
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={{
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 14,
        opacity: disabled ? 0.5 : 1,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: primary ? colors.accent : colors.surface2,
      }}
    >
      <Text style={{ color: primary ? colors.accentForeground : colors.foreground }}>{label}</Text>
    </Pressable>
  );
}

interface LedgerCardProps extends CardProps {
  item: LedgerItem;
  now: number;
  canAnswer: boolean;
  result: Answering | undefined;
  onAnswer: (id: string, pick: number, note: string) => void;
}

function LedgerCard({ item, now, canAnswer, result, onAnswer, colors, compact }: LedgerCardProps) {
  const [selected, setSelected] = useState<PickState>(null);
  const [note, setNote] = useState("");
  const busy = result?.busy === true;
  const chosen = selected === null ? null : item.options[selected - 1];

  return (
    <View style={cardStyle({ colors, compact })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Chip colors={colors} text={item.project} />
        <Text style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: 13 }}>
          {item.asker}
        </Text>
        <Text style={{ marginLeft: "auto", color: colors.foregroundMuted, fontSize: 12 }}>
          {formatAge(now - item.created)}
        </Text>
      </View>
      <Text style={{ color: colors.foreground, fontSize: compact ? 15 : 16 }}>{item.question}</Text>
      <View style={{ gap: 6 }}>
        {item.options.map((option, index) => {
          const number = index + 1;
          const recommended = item.recommend === number;
          const active = selected === number;
          return (
            <Pressable
              key={number}
              accessibilityRole="button"
              accessibilityLabel={`Option ${number}: ${option}${recommended ? ", recommended" : ""}`}
              accessibilityState={{ disabled: !canAnswer || busy, selected: active }}
              disabled={!canAnswer || busy}
              onPress={() => setSelected(number)}
              style={{
                borderRadius: 8,
                borderWidth: 1,
                borderColor: active || recommended ? colors.accent : colors.border,
                backgroundColor: active ? colors.surface2 : colors.surface0,
                paddingVertical: 10,
                paddingHorizontal: 12,
                gap: 2,
                opacity: canAnswer ? 1 : 0.7,
              }}
            >
              <Text style={{ color: colors.foreground }}>{`${number}. ${option}`}</Text>
              {recommended ? (
                <Text style={{ color: colors.accent, fontSize: 12 }}>Recommended</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {canAnswer ? (
        <TextInput
          accessibilityLabel="Optional note to send with the answer"
          editable={!busy}
          maxLength={1000}
          onChangeText={setNote}
          placeholder="Optional note"
          placeholderTextColor={colors.foregroundMuted}
          style={{
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface0,
            color: colors.foreground,
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
          value={note}
        />
      ) : (
        <Text style={{ color: colors.statusWarning, fontSize: 13 }}>{NOT_INSTALLED}</Text>
      )}
      {chosen !== null && selected !== null && !busy ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground }}>
            {`Send option ${selected}: ${chosen}?`}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              colors={colors}
              primary
              label="Send"
              onPress={() => {
                onAnswer(item.id, selected, note);
                setSelected(null);
              }}
            />
            <Button colors={colors} label="Cancel" onPress={() => setSelected(null)} />
          </View>
        </View>
      ) : null}
      {result ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            fontSize: 13,
            color: result.busy
              ? colors.foregroundMuted
              : result.ok
                ? colors.statusSuccess
                : colors.statusDanger,
          }}
        >
          {result.busy ? "Sending…" : result.message}
        </Text>
      ) : null}
    </View>
  );
}

function AnsweredCard({ item, colors, compact }: CardProps & { item: LedgerItem }) {
  const answer = item.answer;
  const picked = answer ? `${answer.pick}. ${answer.text}` : "";
  return (
    <View style={cardStyle({ colors, compact })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Chip colors={colors} text={item.project} />
        <Text style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: 13 }}>
          {item.asker}
        </Text>
      </View>
      <Text style={{ color: colors.foreground }}>{item.question}</Text>
      {answer ? (
        <Text style={{ color: colors.statusSuccess, fontSize: 13 }}>
          {`Answered ${picked}${answer.note ? ` (${answer.note})` : ""}`}
        </Text>
      ) : null}
      {answer?.delivery ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{answer.delivery}</Text>
      ) : null}
    </View>
  );
}

function AgentCard({
  agent,
  now,
  colors,
  compact,
  onOpen,
}: CardProps & { agent: QueueAgent; now: number; onOpen: (id: string) => void }) {
  const project = useWorkspace(agent.workspaceId ?? "", (workspace) => workspace.projectDisplayName);
  const since = Date.parse(agent.attentionTimestamp ?? "");
  return (
    <View style={cardStyle({ colors, compact })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Chip colors={colors} text={project ?? ""} />
        <Text style={{ marginLeft: "auto", color: colors.foregroundMuted, fontSize: 12 }}>
          {Number.isFinite(since) ? `waiting ${formatAge(now - since)}` : "waiting"}
        </Text>
      </View>
      <Text style={{ color: colors.foreground, fontSize: compact ? 15 : 16 }}>
        {agent.title || "Untitled agent"}
      </Text>
      <View style={{ flexDirection: "row" }}>
        <Button colors={colors} primary label="Open agent" onPress={() => onOpen(agent.id)} />
      </View>
    </View>
  );
}

function Heading({ colors, text, count }: { colors: Colors; text: string; count: number }) {
  return (
    <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>
      {`${text} (${count})`}
    </Text>
  );
}

export function DecisionsScreen({ host, theme, layout, navigation }: PluginScreenProps) {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  const answer = useRpc(answerDecision);
  const ledger = useLedger(host.id, REFRESH_MS);
  const agents = useQuery({
    queryKey: ["questions-please", "decisions-agents", host.id],
    queryFn: async ({ signal }) => waitingQueue(await readAllAgents(paseo, signal)),
    refetchInterval: REFRESH_MS,
    retry: false,
    staleTime: 1_000,
  });
  const [tick, setTick] = useState(Date.now());
  const [results, setResults] = useState<Results>({});
  const [showAnswered, setShowAnswered] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const colors = theme.colors;
  const compact = layout.compact;
  const data = ledger.data;
  // Ages follow the daemon's clock: the offset is measured when the list arrives.
  const now = tick + (data ? data.now - ledger.dataUpdatedAt : 0);

  const send = (id: string, pick: number, note: string) => {
    setResults((all) => ({ ...all, [id]: { busy: true, ok: false, message: "" } }));
    answer({ id, pick, ...(note.trim() ? { note: note.trim() } : {}) })
      .then((outcome) => {
        const earlier = outcome.earlier ? ` (${outcome.earlier.pick}. ${outcome.earlier.text})` : "";
        setResults((all) => ({
          ...all,
          [id]: { busy: false, ok: outcome.ok, message: `${outcome.message}${earlier}` },
        }));
      })
      .catch((error: unknown) =>
        setResults((all) => ({
          ...all,
          [id]: {
            busy: false,
            ok: false,
            message: error instanceof Error ? error.message : "The answer could not be sent",
          },
        })),
      )
      .finally(() => void queryClient.invalidateQueries({ queryKey: ["questions-please", "ledger"] }));
  };

  const waiting = data?.waiting ?? [];
  const answered = data?.answered ?? [];
  const waitingAgents = [...(agents.data ?? [])].sort(
    (a, b) => queueKey(a).time - queueKey(b).time,
  );
  const failure = ledger.error?.message ?? agents.error?.message ?? null;
  const nothing =
    !ledger.isPending &&
    !agents.isPending &&
    waiting.length === 0 &&
    waitingAgents.length === 0 &&
    answered.length === 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{ padding: compact ? 12 : 24, gap: 12, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: MAX_CARD_WIDTH, gap: 12 }}>
        {failure ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.statusDanger }}>
            {failure}
          </Text>
        ) : null}
        {nothing ? (
          <Text style={{ color: colors.foregroundMuted }}>Nothing is waiting for you.</Text>
        ) : null}
        {waiting.length > 0 ? (
          <Heading colors={colors} text="Waiting for you" count={waiting.length} />
        ) : null}
      </View>
      {waiting.map((item) => (
        <LedgerCard
          key={item.id}
          item={item}
          now={now}
          canAnswer={data?.canAnswer === true}
          result={results[item.id]}
          onAnswer={send}
          colors={colors}
          compact={compact}
        />
      ))}
      {waitingAgents.length > 0 ? (
        <View style={{ width: "100%", maxWidth: MAX_CARD_WIDTH }}>
          <Heading colors={colors} text="Agents on a card" count={waitingAgents.length} />
        </View>
      ) : null}
      {waitingAgents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          now={tick}
          colors={colors}
          compact={compact}
          onOpen={(agentId) => navigation?.openAgent({ agentId, serverId: host.id })}
        />
      ))}
      {answered.length > 0 ? (
        <View style={{ width: "100%", maxWidth: MAX_CARD_WIDTH, gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showAnswered }}
            onPress={() => setShowAnswered((open) => !open)}
          >
            <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>
              {`${showAnswered ? "▾" : "▸"} Answered today (${answered.length})`}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {showAnswered
        ? answered.map((item) => (
            <AnsweredCard key={item.id} item={item} colors={colors} compact={compact} />
          ))
        : null}
    </ScrollView>
  );
}
