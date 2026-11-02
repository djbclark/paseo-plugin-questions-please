/**
 * Which agents the plugin cycles through, and in what order.
 *
 * To cycle through another kind of agent later (failed, ready to review), add its name to
 * `WaitingBucket`: the compiler then demands a matcher in `MATCHERS`. Then list it in
 * `ENABLED_BUCKETS`.
 */
export type WaitingBucket = "needs_input";

/** The subset of a Paseo agent snapshot the queue reads. */
export interface QueueAgent {
  id: string;
  title?: string | null;
  workspaceId?: string | null;
  archivedAt?: string | null;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: string | null;
  pendingPermissions?: readonly unknown[];
}

// Mirrors `deriveAgentStateBucket` in @getpaseo/protocol. Plugins cannot import that package,
// so the rule is restated here. Questions, plans, tool approvals and mode switches are all
// permission requests, which is why "has a picklist waiting" and "needs input" are one bucket.
const MATCHERS: Record<WaitingBucket, (agent: QueueAgent) => boolean> = {
  needs_input: (agent) =>
    (agent.pendingPermissions?.length ?? 0) > 0 || agent.attentionReason === "permission",
};

export const ENABLED_BUCKETS: readonly WaitingBucket[] = ["needs_input"];

/** Total order of the queue: longest waiting first, ties broken by id. */
export interface QueueKey {
  time: number;
  id: string;
}

export function queueKey(agent: QueueAgent): QueueKey {
  const time = Date.parse(agent.attentionTimestamp ?? "");
  // An agent with no timestamp sorts after every dated one.
  return { time: Number.isFinite(time) ? time : Number.POSITIVE_INFINITY, id: agent.id };
}

function compareKeys(a: QueueKey, b: QueueKey): number {
  if (a.time !== b.time) return a.time < b.time ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function waitingQueue<T extends QueueAgent>(
  agents: Iterable<T>,
  buckets: readonly WaitingBucket[] = ENABLED_BUCKETS,
): T[] {
  return Array.from(agents)
    .filter(
      (agent) =>
        Boolean(agent.workspaceId) &&
        !agent.archivedAt &&
        buckets.some((bucket) => MATCHERS[bucket](agent)),
    )
    .sort((a, b) => compareKeys(queueKey(a), queueKey(b)));
}

/**
 * The first agent after `cursor` in queue order, wrapping to the start. `cursor` is the key of
 * the agent the previous jump opened. Comparing keys rather than looking the agent up means
 * the cycle still advances when that agent was answered and left the queue. A null cursor
 * starts at the longest-waiting agent.
 */
export function nextAfter<T extends QueueAgent>(
  queue: readonly T[],
  cursor: QueueKey | null,
): T | null {
  if (queue.length === 0) return null;
  if (!cursor) return queue[0] ?? null;
  return queue.find((agent) => compareKeys(queueKey(agent), cursor) > 0) ?? queue[0] ?? null;
}
