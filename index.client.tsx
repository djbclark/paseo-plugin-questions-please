import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DECISIONS_SCREEN_ID, DecisionsScreen } from "./client/decisions";
import { JUMP_SCREEN_ID, JumpScreen } from "./client/jump";
import { NextQuestionItem } from "./client/sidebar-item";
import { ShortcutSettings } from "./client/settings";
import { installShortcut } from "./client/web";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: JUMP_SCREEN_ID, title: "Questions please", Component: JumpScreen }),
    client.addScreen({ id: DECISIONS_SCREEN_ID, title: "Decisions", Component: DecisionsScreen }),
    client.addSettingsScreen({
      id: "shortcut",
      title: "Shortcut",
      icon: "Keyboard",
      Component: ShortcutSettings,
    }),
    client.addSidebarHeaderItem({
      id: "questions-please",
      title: "Questions please",
      Component: NextQuestionItem,
    }),
    client.addCommandCenterItem({
      id: "questions-please",
      title: "Next waiting question",
      icon: "CircleAlert",
      keywords: ["waiting", "question", "input", "permission", "picklist", "approve", "next"],
      context: "global",
      onSelect: ({ openScreen }) =>
        openScreen({ screenId: JUMP_SCREEN_ID, params: { n: String(Date.now()) } }),
    }),
    client.addCommandCenterItem({
      id: "decisions",
      title: "Decisions",
      icon: "CircleAlert",
      keywords: ["decisions", "questions", "ledger", "relay", "answer", "waiting"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: DECISIONS_SCREEN_ID }),
    }),
    installShortcut(() =>
      client.openScreen({ screenId: JUMP_SCREEN_ID, params: { n: String(Date.now()) } }),
    ),
  ];

  return () => {
    for (const remove of removers) void remove();
  };
}
