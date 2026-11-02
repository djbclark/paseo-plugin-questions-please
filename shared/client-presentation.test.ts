import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as shortcut from "./shortcut.ts";

type Web = typeof import("../client/web.ts");
interface Element {
  type: string;
  props: {
    children?: Element | (Element | null)[] | string | number;
    style?: Record<string, unknown>;
    label?: string;
    active?: boolean;
    onPress?: () => void;
  };
}

// Evaluate the real client modules with explicit host adapters. No browser, React
// renderer, or queue subscription runs here; these checks cover presentation and
// the device storage boundary rather than full app interaction.
function load<T>(file: string, imports: Record<string, unknown>, globals = {}): T {
  const module = { exports: {} };
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  });
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (id: string) => {
      assert.ok(Object.hasOwn(imports, id), `Unexpected client dependency: ${id}`);
      return imports[id];
    },
    ...globals,
  });
  return module.exports as T;
}

const STORAGE_KEY = "paseo-plugin-questions-please.combo";
function device(platform = "web", mac = true) {
  const handlers = new Set<(event: { key: string | null }) => void>();
  const data = new Map<string, string>();
  let refused = false;
  const globals =
    platform === "web"
      ? {
          navigator: { platform: mac ? "MacIntel" : "Linux" },
          window: {
            addEventListener: (_: string, listener: (event: { key: string | null }) => void) =>
              handlers.add(listener),
            removeEventListener: (_: string, listener: (event: { key: string | null }) => void) =>
              handlers.delete(listener),
          },
          localStorage: {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => {
              if (refused) throw new Error("Storage denied");
              data.set(key, value);
            },
            removeItem: (key: string) => {
              if (refused) throw new Error("Storage denied");
              data.delete(key);
            },
          },
        }
      : {};
  const api = load<Web>(
    "client/web.ts",
    {
      "react-native": { Platform: { OS: platform } },
      "../shared/shortcut": shortcut,
    },
    globals,
  );
  return {
    api,
    handlers,
    data,
    refuse: () => {
      refused = true;
    },
    storageEvent: (key: string | null) => {
      for (const handler of handlers) handler({ key });
    },
  };
}

function render(api: Web, count: number | null, surface0 = "#181b19", ledger?: number) {
  const jsx = (type: string, props: Element["props"]): Element => ({ type, props });
  const { NextQuestionItem } = load<{ NextQuestionItem(props: unknown): Element }>(
    "client/sidebar-item.tsx",
    {
      "@getpaseo/plugin/client": { usePaseo: () => ({}) },
      "@getpaseo/plugin/client/ui": { SidebarRow: "SidebarRow" },
      "@tanstack/react-query": { useQuery: () => ({ data: count }), useQueryClient: () => ({}) },
      react: {
        useEffect: () => {},
        useSyncExternalStore: (_: unknown, snapshot: () => string) => snapshot(),
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-native": { Text: "Text", View: "View" },
      "../shared/shortcut": shortcut,
      "./web": api,
      "../shared/queue": {},
      "./directory": {},
      "./decisions": {
        DECISIONS_SCREEN_ID: "decisions",
        useLedger: () => ({
          data: ledger === undefined ? undefined : { waiting: new Array(ledger).fill({}) },
        }),
      },
    },
  );
  let opened: { screenId: string } | undefined;
  const row = NextQuestionItem({
    theme: { colors: { surface0, foregroundMuted: "#888888" } },
    openScreen: (target: { screenId: string }) => {
      opened = target;
    },
    host: { id: "host" },
    currentScreen: { screenId: "decisions" },
  });
  // SidebarRow is the host boundary: inspect its supplied trailing contribution.
  const trailing = (row.props as Element["props"] & { trailing: Element }).trailing;
  assert.ok(Array.isArray(trailing.props.children));
  return { row, parts: trailing.props.children, opened: () => opened };
}

function children(element: Element | null | undefined): (Element | null)[] {
  assert.ok(element && Array.isArray(element.props.children));
  return element.props.children;
}

describe("sidebar presentation", () => {
  for (const [surface, warning] of [
    ["#181b19", "#db932e"],
    ["#ffffff", "#b37824"],
    ["rgb(255, 255, 255)", "#b37824"],
  ]) {
    for (const count of [null, 0, 1, 3]) {
      it(`renders waiting count ${count} on ${surface}`, () => {
        const {
          row,
          parts: [key, status],
          opened,
        } = render(device().api, count, surface);
        assert.equal(row.props.label, "Questions please");
        assert.equal(row.props.active, true);
        row.props.onPress?.();
        assert.equal(opened()?.screenId, "decisions");
        if (!count) {
          assert.equal(key, null);
          assert.equal(status, null);
          return;
        }
        assert.equal(key?.props.children, "⇧⌘.");
        const [box, label] = children(status);
        assert.equal(box?.props.style?.width, 14);
        assert.equal(box?.props.style?.height, 14);
        const ring = box?.props.children as Element;
        assert.equal(ring.props.style?.width, 10.5);
        assert.equal(ring.props.style?.height, 10.5);
        assert.equal(ring.props.style?.borderWidth, 1.3125);
        assert.equal(ring.props.style?.borderColor, warning);
        assert.equal(ring.props.children, undefined, "Waiting has no center dot");
        assert.equal(ring.props.style?.transform, undefined, "Waiting does not rotate");
        assert.equal(label?.props.children, count);
        assert.equal(label?.props.style?.color, warning);
        assert.equal(label?.props.style?.fontWeight, "600");
        assert.equal((label?.props.style?.fontVariant as string[]).join(), "tabular-nums");
        assert.equal(status?.props.style?.gap, 3);
      });
    }
  }

  it("shows a saved shortcut and restores the default after reset", () => {
    const { api } = device();
    api.writeCombo({ code: "KeyU", mod: true, shift: false, alt: true });
    assert.equal(render(api, 1).parts[0]?.props.children, "⌥⌘U");
    api.writeCombo(null);
    assert.equal(render(api, 1).parts[0]?.props.children, "⇧⌘.");
  });

  it("shows Ctrl notation on other desktop platforms", () => {
    assert.equal(render(device("web", false).api, 1).parts[0]?.props.children, "Ctrl+Shift+.");
  });

  for (const platform of ["ios", "android"]) {
    it(`omits shortcuts on ${platform} without accessing DOM globals`, () => {
      const { api, handlers } = device(platform);
      api.subscribeCombo(() => {})();
      assert.equal(handlers.size, 0);
      const [key, status] = render(api, 2).parts;
      assert.equal(key, null);
      assert.ok(status);
    });
  }
});

describe("sidebar count with ledger questions", () => {
  const label = (ledger: number | undefined, agents: number | null) => {
    const { parts } = render(device().api, agents, "#181b19", ledger);
    return parts[1] ? children(parts[1])[1]?.props.children : null;
  };
  it("adds open ledger questions to waiting agents", () => {
    assert.equal(label(2, 3), 5);
    assert.equal(label(2, 0), 2);
  });
  it("counts agents alone when the ledger is unavailable and waits for the agent count", () => {
    assert.equal(label(undefined, 3), 3);
    assert.equal(label(4, null), null);
  });
});

describe("shortcut storage observation", () => {
  it("notifies on successful saves and resets, not failed writes", () => {
    const { api, refuse } = device();
    let changes = 0;
    const unsubscribe = api.subscribeCombo(() => changes++);
    api.writeCombo({ code: "KeyU", mod: true, shift: false, alt: true });
    assert.equal(changes, 1);
    api.writeCombo(null);
    assert.equal(changes, 2);
    refuse();
    assert.throws(() => api.writeCombo(shortcut.DEFAULT_COMBO), /Storage denied/);
    assert.throws(() => api.writeCombo(null), /Storage denied/);
    assert.equal(changes, 2);
    unsubscribe();
  });

  it("observes relevant cross-window changes and removes listeners on cleanup", () => {
    const { api, data, storageEvent, handlers } = device();
    let changes = 0;
    const unsubscribe = api.subscribeCombo(() => changes++);
    storageEvent("unrelated");
    assert.equal(changes, 0);
    data.set(STORAGE_KEY, JSON.stringify({ code: "KeyU", mod: true, shift: false, alt: true }));
    storageEvent(STORAGE_KEY);
    assert.equal(changes, 1);
    assert.equal(render(api, 1).parts[0]?.props.children, "⌥⌘U");
    data.clear();
    storageEvent(null);
    assert.equal(changes, 2);
    assert.equal(render(api, 1).parts[0]?.props.children, "⇧⌘.");
    unsubscribe();
    assert.equal(handlers.size, 0);
    api.writeCombo(shortcut.DEFAULT_COMBO);
    storageEvent(STORAGE_KEY);
    assert.equal(changes, 2);
  });
});
