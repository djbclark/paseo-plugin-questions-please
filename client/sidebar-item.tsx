import { usePaseo, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { formatCombo } from "../shared/shortcut";
import { isMac, readCombo, shortcutsSupported, subscribeCombo } from "./web";
import { waitingQueue } from "../shared/queue";
import { readAllAgents } from "./directory";
import { DECISIONS_SCREEN_ID, useLedger } from "./decisions";

const COUNT_KEY = ["questions-please", "count"] as const;
const REFRESH_DEBOUNCE_MS = 400;
const BACKSTOP_MS = 30_000;
const LEDGER_POLL_MS = 15_000;

/** How many agents are waiting. Daemon updates trigger a re-read; a slow poll backs them up. */
function useWaitingCount(): number | null {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  const count = useQuery({
    queryKey: COUNT_KEY,
    queryFn: async ({ signal }) => waitingQueue(await readAllAgents(paseo, signal)).length,
    refetchInterval: BACKSTOP_MS,
    staleTime: REFRESH_DEBOUNCE_MS,
  });

  useEffect(() => {
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release: (() => Promise<void>) | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: COUNT_KEY }),
        REFRESH_DEBOUNCE_MS,
      );
    };
    void paseo.agents
      .list({ subscribe: {}, signal: lifetime.signal })
      .then(async ({ subscription }) => {
        if (lifetime.signal.aborted) {
          await subscription.release();
          return;
        }
        release = () => subscription.release();
        subscription.subscribe({
          snapshot: refresh,
          update: (message) => {
            if (message.type === "agent_update") refresh();
          },
        });
      })
      .catch((error: unknown) => {
        if (!lifetime.signal.aborted)
          console.error("questions-please: agent observation failed", error);
      });
    return () => {
      lifetime.abort();
      clearTimeout(timer);
      void release?.().catch(() => {});
    };
  }, [paseo, queryClient]);

  return count.data ?? null;
}

function shortcutLabel(): string {
  return shortcutsSupported ? formatCombo(readCombo(), isMac) : "";
}

export function NextQuestionItem({ currentScreen, openScreen, theme, host }: PluginSidebarItemProps) {
  const agentCount = useWaitingCount();
  // Open ledger questions add to the waiting agents. A host without the ledger RPC counts none.
  const ledger = useLedger(host.id, LEDGER_POLL_MS);
  const count = agentCount === null ? null : agentCount + (ledger.data?.waiting.length ?? 0);
  const shortcut = useSyncExternalStore(subscribeCombo, shortcutLabel, () => "");
  // Match Better Paseo Tasks' status palette, which is brighter than statusWarning.
  const rgb = theme.colors.surface0.match(/^#([0-9a-f]{6})/i)?.[1];
  const channels = rgb
    ? [0, 2, 4].map((offset) => Number.parseInt(rgb.slice(offset, offset + 2), 16))
    : theme.colors.surface0
        .match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i)
        ?.slice(1, 4)
        .map(Number);
  const dark =
    !channels || (0.299 * channels[0]! + 0.587 * channels[1]! + 0.114 * channels[2]!) / 255 < 0.5;
  const warning = dark ? "#db932e" : "#b37824";
  return (
    <SidebarRow
      icon="CircleAlert"
      label="Questions please"
      trailing={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {count !== null && count > 0 && shortcut ? (
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>{shortcut}</Text>
          ) : null}
          {count !== null && count > 0 ? (
            <View
              accessible
              accessibilityLabel={`${count} waiting for you`}
              style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
            >
              <View
                style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}
              >
                <View
                  style={{
                    width: 10.5,
                    height: 10.5,
                    borderRadius: 5.25,
                    borderWidth: 1.3125,
                    borderColor: warning,
                  }}
                />
              </View>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "600",
                  color: warning,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {count}
              </Text>
            </View>
          ) : null}
        </View>
      }
      active={currentScreen?.screenId === DECISIONS_SCREEN_ID}
      onPress={() => openScreen({ screenId: DECISIONS_SCREEN_ID })}
    />
  );
}
