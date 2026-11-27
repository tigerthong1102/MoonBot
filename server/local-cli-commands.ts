import { runSentinelCli } from "./sentinel/cli.ts";
import { runConfigCli } from "./config-cli.ts";
import { runPersistentCli } from "./persistent-cli.ts";

export const localCliCommands = new Map<string, (args: string[]) => number | Promise<number>>([
  ["config", runConfigCli],
  ["sentinel", runSentinelCli],
  ["terminal", runPersistentCli],
]);
