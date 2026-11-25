import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AI_TWIN_NAME_MAX, AI_TWIN_STYLE_MAX, type AiTwinProfile, type AiTwinView } from "../shared/ai-twin.ts";
import { writeFileAtomic } from "./atomic.ts";

export const AI_TWIN_PRIVATE_DIR = "ai-twin";
const MAX_FILE_BYTES = 16_384;
const id = z.uuid();
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const style = z.string().trim().max(AI_TWIN_STYLE_MAX);
const name = z.string().trim().min(1).max(AI_TWIN_NAME_MAX);

const epoch = z.union([z.literal("initial"), id]);
export const createTwinInput = z.strictObject({ name, creationEpoch: epoch, creationId: id, createConsent: z.literal(true) });
export const twinVersionInput = z.strictObject({ id, revision });
export const updateTwinInput = twinVersionInput.extend({ name, style, paused: z.boolean() });

const storedTwin = updateTwinInput.extend({
  creationId: id,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
type StoredTwin = z.infer<typeof storedTwin>;
const storedState = z.strictObject({
  schemaVersion: z.literal(1),
  owner: z.literal("desktop-owner"),
  workspace: z.string().min(1),
  creationEpoch: epoch,
  twin: storedTwin.nullable(),
});
type StoredState = z.infer<typeof storedState>;

export class TwinConflict extends Error {}

export function createAiTwinStore(dataDir: string, workspace: string) {
  const directory = join(dataDir, AI_TWIN_PRIVATE_DIR);
  const file = join(directory, "profile.json");

  function directoryExists(): boolean {
    try {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid Twin directory");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  const empty: StoredState = { schemaVersion: 1, owner: "desktop-owner", workspace, creationEpoch: "initial", twin: null };

  function read(): StoredState {
    if (!directoryExists()) return empty;
    let fd: number;
    let original;
    try {
      original = lstatSync(file);
      if (!original.isFile()) throw new Error("Invalid Twin file");
      const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK;
      fd = openSync(file, constants.O_RDONLY | noFollow);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== original.dev || stat.ino !== original.ino || stat.size > MAX_FILE_BYTES) {
        throw new Error("Invalid Twin file");
      }
      const uid = process.getuid?.();
      if (uid !== undefined && (stat.uid !== uid || (stat.mode & 0o077) !== 0)) throw new Error("Invalid Twin file permissions");
      const state = storedState.parse(JSON.parse(readFileSync(fd, "utf8")));
      if (state.workspace !== workspace) throw new Error("Twin belongs to another workspace");
      return state;
    } finally {
      closeSync(fd);
    }
  }

  function view(state: StoredState): AiTwinView {
    const { twin, creationEpoch } = state;
    return { twin: twin ? publicProfile(twin) : null, creationEpoch };
  }

  function save(state: StoredState): AiTwinView {
    if (!directoryExists()) mkdirSync(directory, { mode: 0o700 });
    writeFileAtomic(file, JSON.stringify(state), { mode: 0o600 });
    return view(state);
  }

  function publicProfile({ id, name, style, paused, revision, createdAt, updatedAt }: StoredTwin): AiTwinProfile {
    return { id, name, style, paused, revision, createdAt, updatedAt };
  }

  function matching(state: StoredState, input: z.infer<typeof twinVersionInput>): StoredTwin {
    const twin = state.twin;
    if (!twin || twin.id !== input.id || twin.revision !== input.revision) throw new TwinConflict("Twin changed");
    return twin;
  }

  return {
    get(): AiTwinView {
      return view(read());
    },
    create(input: z.infer<typeof createTwinInput>): { view: AiTwinView; created: boolean } {
      const state = read();
      if (state.creationEpoch !== input.creationEpoch) throw new TwinConflict("Twin changed");
      if (state.twin) {
        if (state.twin.creationId !== input.creationId) throw new TwinConflict("Twin already exists");
        return { view: view(state), created: false };
      }
      const now = Date.now();
      const twin: StoredTwin = {
        creationId: input.creationId, id: randomUUID(), name: input.name,
        style: "", paused: false, revision: 1, createdAt: now, updatedAt: now,
      };
      return { view: save({ ...state, twin }), created: true };
    },
    update(input: z.infer<typeof updateTwinInput>): AiTwinView {
      const state = read();
      const twin = matching(state, input);
      return save({
        ...state,
        twin: { ...twin, name: input.name, style: input.style, paused: input.paused, revision: twin.revision + 1, updatedAt: Date.now() },
      });
    },
    delete(input: z.infer<typeof twinVersionInput>): AiTwinView {
      const state = read();
      matching(state, input);
      return save({ ...state, creationEpoch: randomUUID(), twin: null });
    },
  };
}
