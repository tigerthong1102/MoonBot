import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { startEgressBroker } from "./egress-broker.mjs";

const label = "ai.startupbot.egress";
const IMAGE = "node:24.22.2-bookworm";

export function egressHosts(raw: unknown): string[] {
  if (raw === undefined) return [];
  const hosts = (Array.isArray(raw) ? raw : [raw]).map(value => String(value).trim().toLowerCase());
  if (!hosts.length || hosts.length > 16 || hosts.some(host => isIP(host) || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host))) throw new Error("Choose up to 16 exact DNS hostnames for HTTPS reads.");
  return [...new Set(hosts)];
}

type Docker = (args: string[]) => string;
export function launchEgress(docker: Docker, owner: string, hosts: string[], minutes: number) {
  const name = "startupbot-egress-" + randomUUID();
  const id = docker(["run", "--detach", "--rm", "--pull=never", "--name", name, "--label", label + "=" + owner,
    "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--pids-limit=32", "--memory=128m",
    "--log-opt", "max-size=1m", "--log-opt", "max-file=1", "--volume", "/run/egress",
    "--env", "APPROVED_HOSTS=" + JSON.stringify(hosts), "--env", "TASK_MINUTES=" + minutes,
    "--entrypoint", "node", IMAGE, "-e", "(" + startEgressBroker.toString() + ")().catch(() => process.exit(1))"]);
  try {
    docker(["exec", id, "node", "-e", "const fs=require('node:fs');let n=0;const t=setInterval(()=>{if(fs.existsSync('/run/egress/fetch.sock'))clearInterval(t);else if(++n>=100)process.exit(1)},50)"]);
    return id;
  } catch (error) { docker(["stop", "--time", "1", id]); throw error; }
}

export function taskBroker(docker: Docker, id: string, owner: string): string | undefined {
  const broker = docker(["inspect", "--format", '{{index .Config.Labels "ai.startupbot.egress-id"}}', id]);
  if (!/^[a-f0-9]{64}$/.test(broker)) return undefined;
  const active = docker(["ps", "--filter", "id=" + broker, "--filter", "label=" + label + "=" + owner, "--format", "{{.ID}}", "--no-trunc"]);
  return active === broker ? broker : undefined;
}
