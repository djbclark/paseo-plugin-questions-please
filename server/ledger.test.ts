import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  answerArgv,
  answerLedger,
  ledgerPaths,
  listLedger,
  operatorEnv,
  type LedgerPaths,
  type RunRelay,
} from "./ledger.ts";

const NONCE = "SECRET-nonce-4f9a1c7e";
const ID = "q-20261102-120000-abc123";
const NOW = Date.now();

function record(over: Record<string, unknown> = {}) {
  return {
    v: 1,
    id: ID,
    from: { label: "Reviewer" },
    project: "ade",
    question: "Ship it?",
    options: ["Yes", "No", "Later"],
    recommend: 2,
    created: NOW / 1000 - 60,
    expires: NOW / 1000 + 3600,
    state: "open",
    nonce: NONCE,
    ...over,
  };
}

let root: string;
let paths: LedgerPaths;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "qp-ledger-"));
  await mkdir(join(root, "asks"));
  await writeFile(join(root, "relay.py"), 'p.add_argument("--answer") "--nonce" "--operator-token-file" "--via-label"');
  paths = { asks: join(root, "asks"), token: join(root, "operator.token"), relay: join(root, "relay.py") };
});
after(() => rm(root, { recursive: true, force: true }));

async function put(name: string, body: unknown) {
  await writeFile(join(paths.asks, name), typeof body === "string" ? body : JSON.stringify(body));
}

const exits = (code: number | null, stdout = "", stderr = ""): RunRelay => async () => ({ code, stdout, stderr });

describe("ledgerPaths", () => {
  it("puts asks beside RELAY_DEFER_DIR when set, else under ~/.local/state/relay", () => {
    assert.equal(ledgerPaths({ RELAY_DEFER_DIR: "/tmp/x/deferred" }, "/h").asks, "/tmp/x/asks");
    assert.equal(ledgerPaths({}, "/h").asks, "/h/.local/state/relay/asks");
    assert.equal(ledgerPaths({}, "/h").token, "/h/.local/state/relay/operator.token");
  });
});

describe("listLedger", () => {
  it("lists readable records, skips the rest, and never returns the nonce", async () => {
    await put(`${ID}.json`, record());
    await put("q-20261102-120000-bad000.json", "{not json");
    await put("q-20261102-120000-bad001.json", record({ v: 2, id: "q-20261102-120000-bad001" }));
    await put("q-20261102-120000-bad002.json", record({ id: "q-20261102-120000-ffffff" })); // id differs from file name
    await put("notes.txt", "x");
    await symlink(join(root, "relay.py"), join(paths.asks, "q-20261102-120000-bad003.json"));
    const result = await listLedger(paths, NOW);
    assert.deepEqual(result.waiting.map((i) => i.id), [ID]);
    assert.equal(result.canAnswer, true);
    assert.ok(!JSON.stringify(result).includes(NONCE));
  });

  it("returns an empty ledger when the asks directory does not exist", async () => {
    const result = await listLedger({ ...paths, asks: join(root, "missing") }, NOW);
    assert.deepEqual([result.waiting, result.answered], [[], []]);
  });

  it("cannot answer when relay lacks the ledger options", async () => {
    await writeFile(join(root, "old-relay.py"), 'p.add_argument("--wait")');
    const result = await listLedger({ ...paths, relay: join(root, "old-relay.py") }, NOW);
    assert.equal(result.canAnswer, false);
  });
});

describe("answerLedger", () => {
  it("runs relay with the nonce and token file in argv and without PASEO_AGENT_ID", async () => {
    await put(`${ID}.json`, record());
    let seen: { argv: string[]; env: NodeJS.ProcessEnv } | undefined;
    const run: RunRelay = async (argv, env) => {
      seen = { argv, env };
      return { code: 0, stdout: "{}", stderr: "" };
    };
    const outcome = await answerLedger(paths, { id: ID, pick: 2, note: "  fine\n" }, run, {
      PASEO_AGENT_ID: "agent-1",
      HOME: "/h",
    }, NOW);
    assert.equal(outcome.code, "delivered");
    assert.deepEqual(seen?.argv, [
      "-I", paths.relay, "--answer", ID, "2", "--note", "fine",
      "--nonce", NONCE, "--operator-token-file", paths.token, "--via-label", "decisions-screen", "--json",
    ]);
    assert.equal(seen?.env.PASEO_AGENT_ID, undefined);
    assert.equal(seen?.env.HOME, "/h");
  });

  it("maps relay's exit codes and shows the earlier answer on exit 10", async () => {
    await put(`${ID}.json`, record());
    assert.equal((await answerLedger(paths, { id: ID, pick: 1 }, exits(1), {}, NOW)).code, "queued");
    assert.equal((await answerLedger(paths, { id: ID, pick: 1 }, exits(11), {}, NOW)).code, "closed");
    assert.equal((await answerLedger(paths, { id: ID, pick: 1 }, exits(2, "", "error: unrecognized arguments: --nonce"), {}, NOW)).code, "not_installed");
    const raced: RunRelay = async () => {
      await put(`${ID}.json`, record({ state: "answered", answer: { pick: 3, text: "Later", at: NOW / 1000 } }));
      return { code: 10, stdout: "", stderr: "" };
    };
    const outcome = await answerLedger(paths, { id: ID, pick: 1 }, raced, {}, NOW);
    assert.equal(outcome.code, "already_answered");
    assert.deepEqual(outcome.earlier, { pick: 3, text: "Later" });
  });

  it("refuses before running relay when the question is gone, closed or the pick is out of range", async () => {
    let calls = 0;
    const run: RunRelay = async () => (calls++, { code: 0, stdout: "", stderr: "" });
    await put(`${ID}.json`, record());
    assert.equal((await answerLedger(paths, { id: "q-20261102-120000-000000", pick: 1 }, run, {}, NOW)).code, "bad_input");
    assert.equal((await answerLedger(paths, { id: ID, pick: 4 }, run, {}, NOW)).code, "bad_input");
    await put(`${ID}.json`, record({ expires: NOW / 1000 - 1 }));
    assert.equal((await answerLedger(paths, { id: ID, pick: 1 }, run, {}, NOW)).code, "closed");
    await put(`${ID}.json`, record({ nonce: "-x" }));
    assert.equal((await answerLedger(paths, { id: ID, pick: 1 }, run, {}, NOW)).code, "bad_input");
    assert.equal(calls, 0);
  });

  it("reports not installed without reading the ledger when relay lacks --answer", async () => {
    const old = { ...paths, relay: join(root, "old-relay.py") };
    const outcome = await answerLedger(old, { id: ID, pick: 1 }, exits(0), {}, NOW);
    assert.equal(outcome.code, "not_installed");
    assert.equal(outcome.message, "relay ledger not installed yet");
  });
});

describe("answerArgv", () => {
  it("keeps a note that starts with a dash from reading as an option", () => {
    const argv = answerArgv(paths, ID, 1, NONCE, "-rf");
    assert.equal(argv[argv.indexOf("--note") + 1], " -rf");
  });
});

describe("operatorEnv", () => {
  it("drops only the agent id", () => {
    assert.deepEqual(operatorEnv({ PASEO_AGENT_ID: "a", PATH: "/bin" }), { PATH: "/bin" });
  });
});

describe("client bundle", () => {
  it("holds neither the nonce field nor the operator token path", () => {
    const files = ["index.client.tsx"];
    for (const dir of ["client", "shared"])
      for (const name of readdirSync(new URL(`../${dir}/`, import.meta.url)))
        if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) files.push(`${dir}/${name}`);
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.ok(!/nonce|operator\.token|operator-token/i.test(source), file);
    }
  });
});
