# paseo-plugin-questions-please

A [Paseo](https://paseo.sh) plugin that shows what is waiting for you on a **Decisions** screen (relay ledger questions you can answer, plus agents on a card) and jumps to the next agent waiting for your input.
See [OVERVIEW.md](OVERVIEW.md) for what it does and its limits.

## Installation

```sh
paseo plugin add djbclark/questions-please
```

Requires Paseo 0.14 or newer and plugins enabled on the daemon. The keyboard shortcut works in a
browser and in the macOS desktop app (confirmed by the author, 2026-10-30, with the current
default). The first default, Cmd+Shift+U, did not work in the desktop app; the Shortcut settings
screen has a "Check the shortcut" panel for diagnosing a key that does nothing. The sidebar row and
Command Center item work everywhere a host is selected.

To update an existing installation after the registry approves a release:

```sh
paseo plugin update questions-please
```

## Decisions and the relay ledger

The Decisions screen needs djbclark-ade's relay question ledger. On the daemon it reads `~/.local/state/relay/asks/q-*.json` (a sibling of `RELAY_DEFER_DIR` when that is set; files that do not parse or have `v` other than 1 are skipped) and answers by running `python3 -I ~/src/djbclark-ade/skills/session-finder/relay.py --answer q-ID N [--note TEXT] --nonce <record key> --operator-token-file ~/.local/state/relay/operator.token --via-label decisions-screen --json` as an argv list, with `PASEO_AGENT_ID` removed from the environment. Exit codes 0 (delivered), 1 (recorded, queued or refused), 2 (bad input), 10 (already answered) and 11 (withdrawn or expired) are shown on the card. If relay lacks `--answer`, the cards are read-only and say "relay ledger not installed yet". The plugin never writes to the relay state directory; the app never sees the asks directory, the record key or the token path.

The sidebar shows an amber waiting count and hollow circle (waiting agents plus open ledger
questions), with your current shortcut to their left on desktop and web. These hide when nothing is
waiting. The row opens the Decisions screen; the shortcut and the "Next waiting question" Command
Center item still jump to the next agent.

## Limitations

- "Next" means next after the agent this plugin last opened. Paseo does not tell plugins which tab has focus, and a plugin reload restarts the cycle.
- Agent tabs only. Terminals, finished agents and failed agents are not included.
- The shortcut binding is saved per browser or app, not per daemon. Escape while recording also leaves the settings page, because Paseo handles Escape first.
- Installed on several daemons, only one handles the shortcut in a given window.
- Plugin Command Center items need a selected host, so the item is missing on the Open Project screen.

## Develop

```sh
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"        # then: paseo plugin reload questions-please
paseo plugin logs questions-please
```

## Layout

| Path                      | Role                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `shared/queue.ts`         | Which agents are in the queue and the cycle order. Add a bucket here to cycle through more than `needs_input`. |
| `shared/shortcut.ts`      | The key combination: what can be bound, matching, parsing a stored value, display text.                        |
| `client/jump.tsx`         | The screen the shortcut and Command Center item open. Navigation is only handed to screens.                    |
| `client/decisions.tsx`    | The Decisions screen: ledger cards, agents on a card, answered today.                                           |
| `shared/ledger.ts`        | Parses a ledger record into display data, groups it, maps relay's `--answer` exit codes.                        |
| `shared/decisions.ts`     | The two RPC contracts between the screen and the daemon.                                                       |
| `server/ledger.ts`        | Daemon only: reads the asks directory, runs `relay.py --answer`. The only code that touches either.            |
| `client/web.ts`           | The `keydown` listener, the combo recorder and the `localStorage` binding. Plugins have no keybinding API.     |
| `client/sidebar-item.tsx` | Sidebar row with a live waiting count.                                                                         |
| `client/settings.tsx`     | Settings screen to record or reset the shortcut.                                                               |

MIT licensed.
