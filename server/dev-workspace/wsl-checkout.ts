import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join, posix, resolve } from "node:path";
import { commitOf, run } from "./command.ts";

type InsideDistro = (args: string[]) => string;
// Only positional parameters contain local or remote paths. Publish with a same-filesystem, no-overwrite rename.
const publish = `
set -eu
bundle=$1; dest=$2; head=$3; token=$4
parent=$(dirname -- "$dest")
test -d "$parent" && test ! -e "$dest" && test ! -L "$dest" || { echo "Destination must be a new directory." >&2; exit 1; }
stage=$(mktemp -d -- "$parent/.startupbot-stage-XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
git -c advice.detachedHead=false clone --quiet --no-checkout -- "$bundle" "$stage"
git -C "$stage" -c advice.detachedHead=false checkout --quiet --detach "$head"
git -C "$stage" remote remove origin
test "$(git -C "$stage" rev-parse HEAD)" = "$head"
printf '%s\\n%s\\n' "$token" "$head" > "$stage/.git/startupbot-wsl-checkout"
mv -Tn -- "$stage" "$dest"
test ! -d "$stage" || { echo "Destination appeared during transfer." >&2; exit 1; }
`;
const undo = `
set -eu
dest=$1; token=$2
test -d "$dest/.git" && test ! -L "$dest" && test -f "$dest/.git/startupbot-wsl-checkout" || exit 1
receipt="$dest/.git/startupbot-wsl-checkout"
test "$(sed -n '1p' "$receipt")" = "$token" || { echo "Receipt differs." >&2; exit 1; }
current_head=$(git -C "$dest" rev-parse HEAD)
saved_head=$(sed -n '2p' "$receipt")
test "$current_head" = "$saved_head" || { echo "Commit changed." >&2; exit 1; }
changes=$(git -C "$dest" status --porcelain --untracked-files=all --ignored)
test -z "$changes" || { echo "Destination changed." >&2; exit 1; }
saved="$dest.startupbot-undo-$token"
test ! -e "$saved" && test ! -L "$saved" || exit 1
mv -Tn -- "$dest" "$saved"
test ! -d "$dest"
printf '%s' "$saved"
`;
export function wslCheckout(action: string, repo: string, directory: string, token: string, inside: InsideDistro) {
  if (!posix.isAbsolute(directory) || directory === "/" || posix.normalize(directory) !== directory || directory.endsWith("/") || directory.includes("\0") || directory.includes("\n")) throw new Error("Choose an absolute new directory in the selected distribution.");
  if (action === "wsl-undo") {
    if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Choose the receipt from wsl-stage.");
    return { preservedAt: inside(["sh","-c",undo,"startupbot",directory,token]).trim() };
  }
  const head = commitOf(repo, "HEAD");
  const changed = run("git", ["status","--porcelain=v1","-z","--untracked-files=all"],repo).split("\0").filter(Boolean);
  const count = run("git", ["ls-tree","-r","--name-only","-z",head],repo).split("\0").filter(Boolean).length;
  const targetState = inside(["sh","-c",'if [ -e "$1" ] || [ -L "$1" ]; then printf occupied; elif [ -d "$(dirname -- "$1")" ]; then printf available; else printf missing-parent; fi',"startupbot",directory]);
  const plan = { source: resolve(repo), directory, head, committedFiles: count, changedEntries: changed.length, targetState: targetState.trim() };
  if (action === "wsl-preview") return plan;
  if (action !== "wsl-stage" || plan.targetState !== "available" || changed.length) throw new Error("Staging requires a clean source and a new destination. Inspect wsl-preview first.");
  const root = mkdtempSync(join(tmpdir(),"startupbot-wsl-"));
  try {
    const archive = join(root, "committed.bundle");
    run("git",["bundle","create",archive,"HEAD"],repo);
    const savedHead = run("git",["bundle","list-heads",archive,"HEAD"],repo).trim().split(/\s+/)[0];
    if (savedHead !== head) throw new Error("The source revision changed during transfer.");
    const archivePath = inside(["wslpath","-a","-u",archive]).trim();
    const receipt = randomUUID();
    inside(["sh","-c",publish,"startupbot",archivePath,directory,head,receipt]);
    return { ...plan, receipt, staged: true };
  } finally { rmSync(root,{recursive:true,force:true}); }
}
