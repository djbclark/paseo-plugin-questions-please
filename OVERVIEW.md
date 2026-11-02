Shows every question waiting for you in one place and jumps to the agents waiting for your answer.

The **Decisions** screen opens from the "Questions please" row in the sidebar (and "Decisions" in the Command Center). It has three groups, in this order:

1. Waiting for you: open questions from the relay question ledger, oldest first. Each card shows the project, who asked, the question, its options (the recommended one marked) and how long it has waited. Tap an option, optionally add a note, and confirm with Send. The card then shows what relay did with the answer.
2. Agents on a card: every agent Paseo shows as "needs input", with its project, title and how long it has waited, and an Open agent button. Answer those in the agent itself.
3. Answered today: ledger questions answered today, collapsed.

The ledger comes from djbclark-ade's relay (`relay.py --ask`). The daemon reads the question records in `~/.local/state/relay/asks/` (beside `RELAY_DEFER_DIR` when that is set) every 5 seconds while the screen is open, and answers by running `python3 -I ~/src/djbclark-ade/skills/session-finder/relay.py --answer` with the operator token file `~/.local/state/relay/operator.token`, with no agent id in its environment so relay treats the answer as yours. The answer, note and question text never leave the daemon except to relay and the screen; the per-question key and the token path stay on the daemon and are never sent to the app. Without that relay version the ledger stays empty or read-only and answering says "relay ledger not installed yet". Question and option text is shown as plain text, never as markdown or links. The plugin writes nothing in the relay state directory.

The sidebar count adds open ledger questions to the waiting agents.

The next-question shortcut is unchanged:

Jumps to the next agent that is waiting for your answer, in any workspace on the daemon. A question with choices, a plan to approve, a tool permission and a mode switch all count: anything Paseo shows as "needs input".

Press Cmd+Shift+. (period) on macOS or Ctrl+Shift+. on Windows and Linux. Each press opens the agent that has been waiting longest after the one the plugin opened last, switching workspace when needed, and wraps around after the last. When you answer an agent it leaves the queue, so the next press skips it. The same action is in the Command Center as "Next waiting question" and as a "Questions please" row in the sidebar, which shows a right-aligned amber waiting count with a hollow circle. On desktop and web, the current keyboard shortcut appears beside the count. The count, circle and shortcut hide when no agents are waiting. The sidebar row and Command Center item work on mobile. The keyboard shortcut needs a hardware keyboard and a browser or the desktop app; it works in both, in the macOS desktop app as confirmed by the author. The first default, Cmd+Shift+U, did not work in the desktop app, and the "Check the shortcut" panel on the Shortcut settings screen shows what the plugin receives if a key does nothing. The Command Center item appears once a host is selected, so it is missing on the Open Project screen. A device that saved its own combination keeps it; Restore default switches to the current default.

To change the keys, open Settings, then Plugins, then the menu on questions-please, then Shortcut. Press Record and then the new combination, which must include Cmd (macOS), Ctrl or Alt. The choice is saved in that browser or desktop app only, so each device keeps its own. The plugin's shortcut takes priority over a Paseo shortcut on the same keys while it is bound.

Paseo does not tell plugins which agent tab has focus, so "next" is relative to the agent this plugin last opened, not the tab you are looking at. After a plugin reload the cycle restarts at the agent that has waited longest. The plugin reads the agent list and the relay ledger of the daemon it is installed on and sends nothing anywhere else. Agent tabs only: terminals are not included. Finished and failed agents are not included. If the plugin is installed on several daemons, only one of them handles the shortcut in a given window.
