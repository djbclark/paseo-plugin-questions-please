/**
 * Daemon side of the Decisions screen: reads the relay question ledger and answers through
 * `relay.py --answer`. This is the only place that touches the asks directory, the operator
 * token file or relay; the client sees neither paths nor secrets.
 */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  ASK_ID,
  cleanText,
  groupLedger,
  interpretAnswerExit,
  lapsed,
  LIMITS,
  NOT_INSTALLED,
  parseAsk,
  type AnswerOutcome,
  type LedgerGroups,
  type LedgerItem,
} from "../shared/ledger.ts";

/** Longest record file read; a real record is a few kilobytes. */
const MAX_RECORD_BYTES = 256 * 1024;
const RELAY_TIMEOUT_MS = 40_000;
const NONCE = /^[A-Za-z0-9][A-Za-z0-9._~+/=-]{7,127}$/;
export const VIA_LABEL = "decisions-screen";

export interface LedgerPaths {
  /** Directory of `q-*.json` records. */
  asks: string;
  /** Operator token file, created by relay on first use. Its path is passed to relay, never read here. */
  token: string;
  /** relay.py. */
  relay: string;
}

/** `asks/` is a sibling of `RELAY_DEFER_DIR` when that is set, else under `~/.local/state/relay`. */
export function ledgerPaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): LedgerPaths {
  const deferDir = env.RELAY_DEFER_DIR;
  const state = deferDir ? dirname(deferDir) : join(home, ".local", "state", "relay");
  return {
    asks: join(state, "asks"),
    token: join(state, "operator.token"),
    relay: join(home, "src", "djbclark-ade", "skills", "session-finder", "relay.py"),
  };
}

async function readRecordFile(path: string): Promise<unknown> {
  // O_NOFOLLOW: a symlink planted in the asks directory is not followed.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_RECORD_BYTES) return null;
    return JSON.parse(await handle.readFile({ encoding: "utf8" }));
  } finally {
    await handle.close();
  }
}

/** A ledger record and the record's secret key. The key never leaves the daemon. */
export interface ParsedAsk {
  item: LedgerItem;
  nonce: string;
}

/** A record read from its file; null for anything unreadable, unparsable or not version 1. */
export async function readAsk(dir: string, id: string): Promise<ParsedAsk | null> {
  if (!ASK_ID.test(id)) return null;
  try {
    const raw = await readRecordFile(join(dir, `${id}.json`));
    const item = parseAsk(raw);
    if (!item || item.id !== id) return null;
    // parseAsk accepted raw as an object, so the key lookup is safe.
    const nonce = typeof raw === "object" && raw !== null && "nonce" in raw ? raw.nonce : "";
    return { item, nonce: typeof nonce === "string" ? nonce : "" };
  } catch {
    return null;
  }
}

export async function readAsks(dir: string): Promise<ParsedAsk[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const asks = await Promise.all(
    names
      .filter((name) => name.startsWith("q-") && name.endsWith(".json"))
      .map((name) => readAsk(dir, name.slice(0, -".json".length))),
  );
  return asks.filter((ask): ask is ParsedAsk => ask !== null);
}

let installedCache: { key: string; value: boolean } | undefined;

/** Whether relay.py knows `--answer` and the operator-token options. Cached per size and mtime. */
export async function relayCanAnswer(relayPath: string): Promise<boolean> {
  try {
    const info = await stat(relayPath);
    const key = `${relayPath}:${info.size}:${info.mtimeMs}`;
    if (installedCache?.key === key) return installedCache.value;
    const handle = await open(relayPath, constants.O_RDONLY);
    let text: string;
    try {
      text = await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
    const value = ["--answer", "--nonce", "--operator-token-file", "--via-label"].every((flag) =>
      text.includes(`"${flag}"`),
    );
    installedCache = { key, value };
    return value;
  } catch {
    return false;
  }
}

export interface ListResult extends LedgerGroups {
  now: number;
  canAnswer: boolean;
}

export async function listLedger(paths: LedgerPaths, now = Date.now()): Promise<ListResult> {
  const [asks, canAnswer] = await Promise.all([readAsks(paths.asks), relayCanAnswer(paths.relay)]);
  return { now, canAnswer, ...groupLedger(asks.map((ask) => ask.item), now) };
}

/** What `relay.py --answer` is run with. Pure, so the argv can be asserted without running relay. */
export function answerArgv(
  paths: LedgerPaths,
  id: string,
  pick: number,
  nonce: string,
  note: string,
): string[] {
  const argv = ["-I", paths.relay, "--answer", id, String(pick)];
  // argparse reads a leading "-" in a value as an option unless the value holds a space.
  if (note) argv.push("--note", note.startsWith("-") ? ` ${note}` : note);
  argv.push(
    "--nonce",
    nonce,
    "--operator-token-file",
    paths.token,
    "--via-label",
    VIA_LABEL,
    "--json",
  );
  return argv;
}

/** The environment relay runs in: without an agent id, relay treats the caller as the operator. */
export function operatorEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = { ...env };
  delete clean.PASEO_AGENT_ID;
  return clean;
}

export interface RunResult {
  /** Exit code, or null when relay was killed or never started. */
  code: number | null;
  stdout: string;
  stderr: string;
}
export type RunRelay = (argv: string[], env: NodeJS.ProcessEnv) => Promise<RunResult>;

function exitCodeOf(error: unknown): number | null {
  if (error === null) return 0;
  if (typeof error === "object" && "code" in error && typeof error.code === "number")
    return error.code;
  return null;
}

export const runRelay: RunRelay = (argv, env) => {
  const { promise, resolve } = Promise.withResolvers<RunResult>();
  execFile(
    "python3",
    argv,
    { env, timeout: RELAY_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true },
    (error, stdout, stderr) =>
      resolve({ code: exitCodeOf(error), stdout: String(stdout), stderr: String(stderr) }),
  );
  return promise;
};

export interface AnswerResult extends AnswerOutcome {
  earlier: { pick: number; text: string } | null;
}

const refuse = (code: AnswerResult["code"], message: string): AnswerResult => ({
  ok: false,
  code,
  message,
  earlier: null,
});

export async function answerLedger(
  paths: LedgerPaths,
  input: { id: string; pick: number; note?: string | undefined },
  run: RunRelay = runRelay,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<AnswerResult> {
  if (!(await relayCanAnswer(paths.relay))) return refuse("not_installed", NOT_INSTALLED);
  const ask = await readAsk(paths.asks, input.id);
  if (!ask) return refuse("bad_input", "That question is not in the ledger");
  const { item } = ask;
  if (item.state === "answered")
    return {
      ...refuse("already_answered", "Already answered"),
      earlier: item.answer && { pick: item.answer.pick, text: item.answer.text },
    };
  if (item.state !== "open" && item.state !== "seen")
    return refuse("closed", "Withdrawn or expired: no longer open");
  if (lapsed(item, now)) return refuse("closed", "Withdrawn or expired: no longer open");
  if (input.pick < 1 || input.pick > item.options.length)
    return refuse("bad_input", "That option does not exist");
  if (!NONCE.test(ask.nonce)) return refuse("bad_input", "The question record has no usable key");

  const argv = answerArgv(
    paths,
    item.id,
    input.pick,
    ask.nonce,
    cleanText(input.note, LIMITS.note),
  );
  const result = await run(argv, operatorEnv(env));
  const outcome = interpretAnswerExit(result.code, result.stdout, result.stderr);
  let earlier: AnswerResult["earlier"] = null;
  if (outcome.code === "already_answered") {
    const after = await readAsk(paths.asks, item.id);
    const prior = after?.item.answer;
    earlier = prior ? { pick: prior.pick, text: prior.text } : null;
  }
  return { ...outcome, earlier };
}
