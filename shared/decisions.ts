import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { ASK_ID, ASK_STATES, MAX_OPTIONS } from "./ledger";

const answerSchema = z.object({
  pick: z.number(),
  text: z.string(),
  note: z.string(),
  by: z.string(),
  at: z.number().nullable(),
  delivery: z.string(),
});

const itemSchema = z.object({
  id: z.string(),
  project: z.string(),
  asker: z.string(),
  question: z.string(),
  options: z.array(z.string()),
  recommend: z.number(),
  created: z.number(),
  expires: z.number().nullable(),
  state: z.enum(ASK_STATES),
  answer: answerSchema.nullable(),
});

/** Ledger questions for the Decisions screen. Holds display fields only, no secrets. */
export const listDecisions = defineRpc({
  name: "decisions.list",
  input: z.object({}),
  output: z.object({
    /** The daemon's clock, epoch milliseconds, so ages do not depend on the client's clock. */
    now: z.number(),
    /** False until the installed relay has `--answer` and its operator-auth options. */
    canAnswer: z.boolean(),
    waiting: z.array(itemSchema),
    answered: z.array(itemSchema),
  }),
});

export const answerDecision = defineRpc({
  name: "decisions.answer",
  input: z.object({
    id: z.string().regex(ASK_ID),
    pick: z.number().int().min(1).max(MAX_OPTIONS),
    note: z.string().max(1000).optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    code: z.enum([
      "delivered",
      "queued",
      "already_answered",
      "closed",
      "bad_input",
      "not_installed",
      "failed",
    ]),
    message: z.string(),
    /** For `already_answered`: what the earlier answer was. */
    earlier: z.object({ pick: z.number(), text: z.string() }).nullable(),
  }),
});
