/**
 * The relay question ledger as the Decisions screen sees it: one JSON record per question under
 * `~/.local/state/relay/asks/`, written by djbclark-ade's `relay.py --ask`. This module is pure:
 * it parses an unknown JSON value into a display item and decides which group the item falls in.
 * Reading the directory and running `relay.py --answer` live in `server/`.
 *
 * Every field is read defensively. A record that is not an object, has `v` other than 1, has a
 * malformed id, an unknown state or non-string options is skipped, never half shown: an option
 * number must always name the option the operator saw.
 *
 * All text is untrusted. It is cut to a bounded length and stripped of control characters here;
 * the client then renders it as plain `Text`, never as markdown or a link.
 */

export const ASK_ID = /^q-\d{8}-\d{6}-[0-9a-f]{6}$/;
export const ASK_STATES = ["open", "seen", "answered", "withdrawn", "expired"] as const;
export type AskState = (typeof ASK_STATES)[number];

export interface LedgerAnswer {
  pick: number;
  text: string;
  note: string;
  by: string;
  /** Epoch milliseconds, or null when the record carries no usable time. */
  at: number | null;
  delivery: string;
}

/** A ledger question as the client receives it. Carries no secret: the daemon keeps those. */
export interface LedgerItem {
  id: string;
  project: string;
  asker: string;
  question: string;
  options: string[];
  /** 1-based index of the recommended option, 0 for none. */
  recommend: number;
  /** Epoch milliseconds. */
  created: number;
  /** Epoch milliseconds, or null. */
  expires: number | null;
  state: AskState;
  answer: LedgerAnswer | null;
}

export const LIMITS = { question: 2000, option: 400, label: 120, project: 120, note: 1000 } as const;
export const MAX_OPTIONS = 12;

/** Control characters become spaces and the text is cut; newlines survive only as spaces. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Relay writes `time.time()` floats (epoch seconds). Epoch milliseconds and ISO strings are
 * accepted too, so a later change of unit does not blank the screen.
 */
export function toMillis(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim() !== "") {
    n = Number(value);
    if (!Number.isFinite(n)) n = Date.parse(value);
  } else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseAnswer(raw: unknown): LedgerAnswer | null {
  const a = record(raw);
  if (!a) return null;
  const pick = typeof a.pick === "number" && Number.isInteger(a.pick) ? a.pick : 0;
  return {
    pick,
    text: cleanText(a.text, LIMITS.option),
    note: cleanText(a.note, LIMITS.note),
    by: cleanText(a.by, LIMITS.label),
    at: toMillis(a.at),
    delivery: cleanText(a.delivery, LIMITS.question),
  };
}

/** One record file's parsed JSON to a display item, or null when it must be skipped. */
export function parseAsk(raw: unknown): LedgerItem | null {
  const r = record(raw);
  if (!r || r.v !== 1) return null;
  if (typeof r.id !== "string" || !ASK_ID.test(r.id)) return null;
  if (!ASK_STATES.includes(r.state as AskState)) return null;
  if (!Array.isArray(r.options) || r.options.length < 1 || r.options.length > MAX_OPTIONS)
    return null;
  const options: string[] = [];
  for (const option of r.options) {
    const text = cleanText(option, LIMITS.option);
    if (typeof option !== "string" || text === "") return null;
    options.push(text);
  }
  const question = cleanText(r.question, LIMITS.question);
  const created = toMillis(r.created);
  if (question === "" || created === null) return null;
  const from = record(r.from);
  const recommend =
    typeof r.recommend === "number" &&
    Number.isInteger(r.recommend) &&
    r.recommend >= 1 &&
    r.recommend <= options.length
      ? r.recommend
      : 0;
  return {
    id: r.id,
    project: cleanText(r.project, LIMITS.project),
    asker: cleanText(from?.label, LIMITS.label) || cleanText(from?.ident, LIMITS.label),
    question,
    options,
    recommend,
    created,
    expires: toMillis(r.expires),
    state: r.state as AskState,
    answer: parseAnswer(r.answer),
  };
}

/** True while the sweep has not yet marked an open record expired but its time is up. */
export function lapsed(item: LedgerItem, now: number): boolean {
  return (item.state === "open" || item.state === "seen") && item.expires !== null && item.expires <= now;
}

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  );
}

export interface LedgerGroups {
  /** Open or seen, not past `expires`; oldest first. */
  waiting: LedgerItem[];
  /** Answered on the same local day as `now`; newest answer first. */
  answered: LedgerItem[];
}

export function groupLedger(items: readonly LedgerItem[], now: number): LedgerGroups {
  const waiting = items
    .filter((item) => (item.state === "open" || item.state === "seen") && !lapsed(item, now))
    .sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const answeredAt = (item: LedgerItem) => item.answer?.at ?? item.created;
  const answered = items
    .filter((item) => item.state === "answered" && sameLocalDay(answeredAt(item), now))
    .sort((a, b) => answeredAt(b) - answeredAt(a));
  return { waiting, answered };
}

/** "3 min", "2 h 5 min", "1 d 4 h": how long ago, coarse. */
export function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export type AnswerCode =
  | "delivered"
  | "queued"
  | "already_answered"
  | "closed"
  | "bad_input"
  | "not_installed"
  | "failed";

export interface AnswerOutcome {
  /** True only when the answer is recorded and relay delivered it. */
  ok: boolean;
  code: AnswerCode;
  /** One line for the card's result row; never contains a secret. */
  message: string;
}

/** The first short string relay's `--json` output offers about what happened. */
export function relayLine(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "";
  }
  const top = record(parsed);
  if (!top) return "";
  for (const key of ["delivery", "message", "error", "status", "outcome", "line"]) {
    const text = cleanText(top[key], 300);
    if (text) return text;
  }
  const nested = cleanText(record(top.answer)?.delivery, 300);
  return nested;
}

/**
 * Relay's exit code for `--answer`: 0 delivered; 1 recorded but queued or refused; 2 bad input;
 * 10 already answered; 11 withdrawn or expired. An exit 2 whose stderr says the option is
 * unknown means the installed relay predates the ledger.
 */
export function interpretAnswerExit(
  exitCode: number | null,
  stdout: string,
  stderr: string,
): AnswerOutcome {
  const detail = relayLine(stdout);
  const withDetail = (base: string) => (detail ? `${base}: ${detail}` : base);
  switch (exitCode) {
    case 0:
      return { ok: true, code: "delivered", message: withDetail("Answer delivered") };
    case 1:
      return {
        ok: false,
        code: "queued",
        message: withDetail("Answer recorded; relay queued or refused the delivery"),
      };
    case 2:
      if (/unrecognized arguments|unknown option|invalid choice/i.test(stderr))
        return { ok: false, code: "not_installed", message: NOT_INSTALLED };
      return { ok: false, code: "bad_input", message: withDetail("Relay refused the answer") };
    case 10:
      return { ok: false, code: "already_answered", message: "Already answered" };
    case 11:
      return { ok: false, code: "closed", message: "Withdrawn or expired: no longer open" };
    default:
      return {
        ok: false,
        code: "failed",
        message: withDetail(
          exitCode === null ? "Relay did not finish" : `Relay failed (exit ${exitCode})`,
        ),
      };
  }
}

export const NOT_INSTALLED = "relay ledger not installed yet";
