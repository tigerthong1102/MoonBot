import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AI_TWIN_NAME_MAX, AI_TWIN_STYLE_MAX, type AiTwinControls, type AiTwinProfile, type AiTwinView } from "../shared/ai-twin.ts";
import { OWNER_STYLE_TRAITS, type ApprovedOwnerStyle } from "../shared/zalo-owner-style.ts";
import { writeFileAtomic } from "./atomic.ts";
import { MAX_TWIN_LESSONS, storedTwinLesson, twinLessonFields, twinLessonKey, twinLessonLookupFields } from "./ai-twin-lessons.ts";

export const AI_TWIN_PRIVATE_DIR = "ai-twin";
const MAX_FILE_BYTES = 512 * 1024;
const id = z.uuid();
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const style = z.string().trim().max(AI_TWIN_STYLE_MAX);
const name = z.string().trim().min(1).max(AI_TWIN_NAME_MAX);

const epoch = z.union([z.literal("initial"), id]);
export const createTwinInput = z.strictObject({ name, creationEpoch: epoch, creationId: id, createConsent: z.literal(true) });
export const twinVersionInput = z.strictObject({ id, revision });
export const updateTwinInput = twinVersionInput.extend({ name, style, paused: z.boolean() });
const scopeId = z.string().min(1).max(128).regex(/^[\w-]+$/);
export const saveTwinLessonInput = twinVersionInput.extend({
  ...twinLessonFields,
  lessonId: id.optional(),
  saveAsLesson: z.literal(true),
  allowProvider: z.boolean().optional(),
  example: z.strictObject({ thread: scopeId, message: scopeId }).optional(),
});
export const deleteTwinLessonInput = twinVersionInput.extend({ lessonId: id });
export const forgetTwinLessonsInput = twinVersionInput.extend({
  lessonIds: z.array(id).min(1).max(MAX_TWIN_LESSONS).refine((items) => new Set(items).size === items.length),
  confirmForget: z.literal(true),
});
export const lookupTwinLessonInput = twinVersionInput.extend(twinLessonLookupFields);

export const twinLearningInput = twinVersionInput.extend({ thread: scopeId, enabled: z.boolean() });
export const twinDelegationInput = twinVersionInput.extend({ room: scopeId, lesson: id, enabled: z.boolean() });
export const twinPhoneInput = twinVersionInput.extend({ enabled: z.boolean() });
const storedControls = z.strictObject({
  sourceIds: z.array(scopeId).max(12),
  delegations: z.array(z.strictObject({ room: scopeId, lesson: id })).max(80),
  phone: z.boolean(),
});
const emptyControls: AiTwinControls = { sourceIds: [], delegations: [], phone: false };

const storedTwin = updateTwinInput.extend({
  ownerEditorStyle: z.strictObject({ provenance: z.literal("owner-desktop-editor"), traits: z.array(z.enum(OWNER_STYLE_TRAITS)).min(1).max(7),
    approvedAt: z.number().int().nonnegative() }).optional(),
  lessons: z.array(storedTwinLesson).max(MAX_TWIN_LESSONS).optional(),
  controls: storedControls.optional(),
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
export class TwinLessonConflict extends Error {
  readonly code: "twin_lesson_duplicate" | "twin_lessons_full" | "twin_lesson_empty";

  constructor(code: TwinLessonConflict["code"]) {
    super(code);
    this.code = code;
  }
}

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
    return { twin: twin ? publicProfile(twin) : null, creationEpoch, ...(twin ? { lessons: twin.lessons ?? [], controls: twin.controls ?? emptyControls } : {}) };
  }

  function save(state: StoredState): AiTwinView {
    if (!directoryExists()) mkdirSync(directory, { mode: 0o700 });
    const content = JSON.stringify(state);
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new TwinLessonConflict("twin_lessons_full");
    writeFileAtomic(file, content, { mode: 0o600 });
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

  function updateControls(input: z.infer<typeof twinVersionInput>, change: (controls: AiTwinControls, twin: StoredTwin) => AiTwinControls): AiTwinView {
    const state = read();
    const twin = matching(state, input);
    const controls = storedControls.safeParse(change(twin.controls ?? emptyControls, twin));
    if (!controls.success) throw new TwinConflict("Too many Twin sources or grants");
    return save({ ...state, twin: { ...twin, controls: controls.data, revision: twin.revision + 1, updatedAt: Date.now() } });
  }

  function removeGrants(twin: StoredTwin, lesson: string): AiTwinControls | undefined {
    return twin.controls && { ...twin.controls, delegations: twin.controls.delegations.filter((grant) => grant.lesson !== lesson) };
  }

  return {
    setLearning(input: z.infer<typeof twinLearningInput>) {
      return updateControls(input, (controls) => ({
        ...controls, sourceIds: [...controls.sourceIds.filter((id) => id !== input.thread), ...(input.enabled ? [input.thread] : [])],
      }));
    },
    setDelegation(input: z.infer<typeof twinDelegationInput>) {
      return updateControls(input, (controls, twin) => {
        if (input.enabled && !twin.lessons?.some((lesson) => lesson.id === input.lesson)) throw new TwinConflict("Lesson changed");
        const others = controls.delegations.filter((grant) => grant.room !== input.room || grant.lesson !== input.lesson);
        return { ...controls, delegations: [...others, ...(input.enabled ? [{ room: input.room, lesson: input.lesson }] : [])] };
      });
    },
    setPhone(input: z.infer<typeof twinPhoneInput>) {
      return updateControls(input, (controls) => ({ ...controls, phone: input.enabled }));
    },
    roomReply(room: string, question: string) {
      const twin = read().twin;
      if (!twin || twin.paused) return undefined;
      const grants = twin.controls?.delegations;
      const lesson = twin.lessons?.find((entry) => grants?.some((grant) => grant.room === room && grant.lesson === entry.id)
        && twinLessonKey(entry.question) === twinLessonKey(question));
      return lesson && { answer: lesson.answer, twinId: twin.id, revision: twin.revision };
    },
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
    ownerEditorStyle(input: z.infer<typeof twinVersionInput>) {
      return matching(read(), input).ownerEditorStyle;
    },
    setOwnerEditorStyle(input: z.infer<typeof twinVersionInput>, approved?: ApprovedOwnerStyle) {
      const state = read();
      const twin = matching(state, input);
      if (approved && twin.paused) throw new TwinConflict("Twin paused");
      return save({ ...state, twin: { ...twin, ownerEditorStyle: approved, revision: twin.revision + 1, updatedAt: Date.now() } });
    },
    saveLesson(input: z.infer<typeof saveTwinLessonInput>): AiTwinView {
      const state = read();
      const twin = matching(state, input);
      const lessons = twin.lessons ?? [];
      const existing = input.lessonId ? lessons.find((entry) => entry.id === input.lessonId) : undefined;
      if (input.lessonId && !existing) throw new TwinConflict("Lesson changed");
      if (!existing && lessons.length === MAX_TWIN_LESSONS) throw new TwinLessonConflict("twin_lessons_full");
      const key = twinLessonKey(input.question);
      if (!/[\p{L}\p{N}]/u.test(key)) throw new TwinLessonConflict("twin_lesson_empty");
      if (lessons.some((entry) => entry.id !== existing?.id && twinLessonKey(entry.question) === key)) {
        throw new TwinLessonConflict("twin_lesson_duplicate");
      }
      const updatedAt = Date.now();
      const lesson = storedTwinLesson.parse({
        id: existing?.id ?? randomUUID(), question: input.question, answer: input.answer, source: "owner", updatedAt,
        ...(input.allowProvider ? { allowProvider: true } : {}),
      });
      const next = existing ? lessons.map((entry) => entry.id === existing.id ? lesson : entry) : [...lessons, lesson];
      return save({ ...state, twin: { ...twin, lessons: next, controls: existing ? removeGrants(twin, existing.id) : twin.controls, revision: twin.revision + 1, updatedAt } });
    },
    forgetLesson(input: z.infer<typeof deleteTwinLessonInput>): AiTwinView {
      const state = read();
      const twin = matching(state, input);
      const lessons = twin.lessons ?? [];
      const remaining = lessons.filter((entry) => entry.id !== input.lessonId);
      if (remaining.length === lessons.length) throw new TwinConflict("Lesson changed");
      return save({ ...state, twin: { ...twin, lessons: remaining, controls: removeGrants(twin, input.lessonId), revision: twin.revision + 1, updatedAt: Date.now() } });
    },
    forgetLessons(input: z.infer<typeof forgetTwinLessonsInput>): AiTwinView {
      const state = read(), twin = matching(state, input), lessons = twin.lessons ?? [], selected = new Set(input.lessonIds);
      if (!input.confirmForget || !selected.size || selected.size !== input.lessonIds.length || selected.size > MAX_TWIN_LESSONS ||
          input.lessonIds.some((id) => !lessons.some((lesson) => lesson.id === id))) throw new TwinConflict("Lesson changed");
      return save({ ...state, twin: { ...twin, lessons: lessons.filter((lesson) => !selected.has(lesson.id)),
        controls: twin.controls && { ...twin.controls, delegations: twin.controls.delegations.filter((grant) => !selected.has(grant.lesson)) },
        revision: twin.revision + 1, updatedAt: Date.now() } });
    },
    lookupLesson(input: z.infer<typeof lookupTwinLessonInput>) {
      const twin = matching(read(), input);
      if (twin.paused) throw new TwinConflict("Twin paused");
      const key = twinLessonKey(input.question);
      if (!key) return null;
      return twin.lessons?.find((entry) => twinLessonKey(entry.question) === key) ?? null;
    },
    delete(input: z.infer<typeof twinVersionInput>): AiTwinView {
      const state = read();
      matching(state, input);
      return save({ ...state, creationEpoch: randomUUID(), twin: null });
    },
  };
}
