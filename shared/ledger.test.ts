import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAge,
  groupLedger,
  interpretAnswerExit,
  NOT_INSTALLED,
  parseAsk,
  toMillis,
} from "./ledger.ts";

const ID = "q-20261102-120000-abc123";

function rec(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    id: ID,
    from: { ident: "omp:1", label: "Reviewer", paseo: "", fleet: "f1" },
    to: { id: "lead", paseo: "", name: "lead" },
    project: "djbclark-ade",
    question: "Ship it?",
    options: ["Yes", "No"],
    recommend: 1,
    created: 1_793_620_800,
    expires: 1_793_642_400,
    state: "open",
    nonce: "n0nce-abcdef12",
    ...over,
  };
}

describe("parseAsk", () => {
  it("reads a record into a display item that holds no secret", () => {
    const item = parseAsk(rec());
    assert.ok(item);
    assert.equal(item.asker, "Reviewer");
    assert.equal(item.created, 1_793_620_800_000);
    assert.equal(item.recommend, 1);
    assert.ok(!JSON.stringify(item).includes("n0nce"));
  });

  it("skips records it cannot show safely", () => {
    for (const bad of [
      null,
      [],
      "x",
      rec({ v: 2 }),
      rec({ v: undefined }),
      rec({ id: "../q-evil" }),
      rec({ state: "weird" }),
      rec({ options: [] }),
      rec({ options: ["A", 7] }),
      rec({ options: ["A", "  "] }),
      rec({ question: "" }),
      rec({ created: "never" }),
    ])
      assert.equal(parseAsk(bad), null, JSON.stringify(bad));
  });

  it("falls back for missing or out-of-range optional fields", () => {
    const parsed = parseAsk(
      rec({ recommend: 9, from: null, project: 5, expires: null, answer: "x" }),
    );
    assert.ok(parsed);
    assert.equal(parsed.recommend, 0);
    assert.equal(parsed.asker, "");
    assert.equal(parsed.project, "");
    assert.equal(parsed.expires, null);
    assert.equal(parsed.answer, null);
  });

  it("strips control characters and cuts long text", () => {
    const parsed = parseAsk(rec({ question: `a\nb\u0000c${"x".repeat(5000)}`, options: ["A\tB", "C"] }));
    assert.ok(parsed);
    assert.ok(parsed.question.startsWith("a b c"));
    assert.ok(parsed.question.length <= 2000);
    assert.equal(parsed.options[0], "A B");
  });

  it("reads the answer block", () => {
    const parsed = parseAsk(
      rec({
        state: "answered",
        answer: { pick: 2, text: "No", note: "later", by: "djbclark", at: 1_793_621_000, delivery: "delivered" },
      }),
    );
    assert.deepEqual(parsed?.answer, {
      pick: 2,
      text: "No",
      note: "later",
      by: "djbclark",
      at: 1_793_621_000_000,
      delivery: "delivered",
    });
  });
});

describe("toMillis", () => {
  it("accepts epoch seconds, milliseconds and ISO text", () => {
    assert.equal(toMillis(1_793_620_800.5), 1_793_620_800_500);
    assert.equal(toMillis(1_793_620_800_000), 1_793_620_800_000);
    assert.equal(toMillis("2026-11-02T12:00:00Z"), Date.parse("2026-11-02T12:00:00Z"));
    assert.equal(toMillis(0), null);
    assert.equal(toMillis(undefined), null);
  });
});

describe("groupLedger", () => {
  const noon = new Date(2026, 10, 2, 12, 0, 0).getTime();
  const item = (id: string, over: Record<string, unknown>) => {
    const parsed = parseAsk(rec({ id, ...over }));
    assert.ok(parsed);
    return parsed;
  };

  it("lists open and seen oldest first and drops lapsed, withdrawn and expired", () => {
    const seconds = noon / 1000;
    const groups = groupLedger(
      [
        item("q-20261102-110000-000003", { created: seconds - 100, expires: seconds + 100 }),
        item("q-20261102-110000-000001", { created: seconds - 300, expires: seconds + 100, state: "seen" }),
        item("q-20261102-110000-000002", { created: seconds - 200, expires: seconds - 1 }),
        item("q-20261102-110000-000004", { created: seconds - 50, expires: seconds + 9, state: "withdrawn" }),
        item("q-20261102-110000-000005", { created: seconds - 50, expires: seconds + 9, state: "expired" }),
      ],
      noon,
    );
    assert.deepEqual(
      groups.waiting.map((i) => i.id),
      ["q-20261102-110000-000001", "q-20261102-110000-000003"],
    );
    assert.equal(groups.answered.length, 0);
  });

  it("shows only today's answers, newest first", () => {
    const seconds = noon / 1000;
    const answered = (id: string, at: number) =>
      item(id, { state: "answered", created: at - 60, answer: { pick: 1, text: "Yes", at } });
    const groups = groupLedger(
      [
        answered("q-20261102-110000-000001", seconds - 3600),
        answered("q-20261102-110000-000002", seconds - 60),
        answered("q-20261101-110000-000003", seconds - 3 * 86_400),
      ],
      noon,
    );
    assert.deepEqual(
      groups.answered.map((i) => i.id),
      ["q-20261102-110000-000002", "q-20261102-110000-000001"],
    );
  });
});

describe("formatAge", () => {
  it("is coarse", () => {
    assert.equal(formatAge(10_000), "just now");
    assert.equal(formatAge(5 * 60_000), "5 min");
    assert.equal(formatAge(125 * 60_000), "2 h 5 min");
    assert.equal(formatAge(28 * 3_600_000), "1 d 4 h");
  });
});

describe("interpretAnswerExit", () => {
  const json = JSON.stringify({ delivery: "delivered" });
  it("maps relay's documented exit codes", () => {
    assert.deepEqual(
      [0, 1, 2, 10, 11, 3, null].map((code) => interpretAnswerExit(code, "", "").code),
      ["delivered", "queued", "bad_input", "already_answered", "closed", "failed", "failed"],
    );
    assert.equal(interpretAnswerExit(0, json, "").ok, true);
    for (const code of [1, 2, 10, 11, 3, null]) assert.equal(interpretAnswerExit(code, "", "").ok, false);
  });

  it("carries relay's own one-line detail", () => {
    assert.match(interpretAnswerExit(1, JSON.stringify({ message: "queued: r-1" }), "").message, /queued: r-1/);
  });

  it("reports a relay without the ledger as not installed", () => {
    const outcome = interpretAnswerExit(2, "", "relay.py: error: unrecognized arguments: --answer q-1");
    assert.equal(outcome.code, "not_installed");
    assert.equal(outcome.message, NOT_INSTALLED);
  });
});
