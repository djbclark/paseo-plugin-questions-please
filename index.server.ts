import type { PluginServerContext } from "@getpaseo/plugin/server";
import { answerLedger, ledgerPaths, listLedger } from "./server/ledger";
import { answerDecision, listDecisions } from "./shared/decisions";

export default function contribute(server: PluginServerContext) {
  const paths = ledgerPaths();
  server.handle(listDecisions, () => listLedger(paths));
  server.handle(answerDecision, (input) => answerLedger(paths, input));
  return () => {};
}
