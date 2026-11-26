import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { contextText, routedWorkMarker } from "./delta-context.ts";
import type { Message } from "./store.ts";
import { attachmentTagCandidates, type TagCandidate } from "./attachment-tags.ts";

import { ATTACHMENTS_DIR, FILE_MAX_BYTES, IMAGE_MAX_BYTES } from "./attachments.ts";
import type { TurnImageInput, TurnVideoInput } from "./contracts.ts";
import { videoFrameImages } from "./turn-video.ts";

export const TURN_IMAGE_MAX_COUNT = 10;
/** Total image bytes one turn may carry: the 40 MB it was when a turn took four images, so engine requests don't grow. */
export const TURN_IMAGE_MAX_BYTES = 4 * IMAGE_MAX_BYTES;
// A video is sampled into several frames before it reaches a model, so only the first one in a message is sampled.
export const TURN_VIDEO_MAX_COUNT = 1;

const OWNED_IMAGE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
const OWNED_VIDEO_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|webm|mov)$/;
const MIME_BY_EXTENSION: Readonly<Record<string, TurnImageInput["mime"]>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
// Composer video attachments use the generic <attached-file> tag (the same one documents and audio use); only its
// path decides whether it resolves to a video, so every other file kind keeps going through unexamined.
const VIDEO_MIME_BY_EXTENSION: Readonly<Record<string, TurnVideoInput["mime"]>> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function statusError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function ownedAttachment<Mime extends string>(
  path: string,
  attachmentsDir: string,
  nameFormat: RegExp,
  mimeByExtension: Readonly<Record<string, Mime>>,
  maxBytes: number,
): { path: string; mime: Mime; bytes: number } | null {
  if (!path || path.includes("\0")) return null;
  const name = path.split(/[\\/]/).at(-1) ?? "";
  if (!nameFormat.test(name)) return null;

  // A basename match alone would let any /tmp/<uuid>.ext pose as an app attachment: the path must point into this store.
  const expected = resolve(attachmentsDir, name);
  if (resolve(path) !== expected) return null;

  try {
    const entry = lstatSync(expected);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size <= 0 || entry.size > maxBytes) return null;
    const canonicalRoot = realpathSync(attachmentsDir);
    const canonicalFile = realpathSync(expected);
    if (dirname(canonicalFile) !== canonicalRoot) return null;
    const finalEntry = statSync(canonicalFile);
    if (!finalEntry.isFile() || finalEntry.size !== entry.size) return null;
    const mime = mimeByExtension[extname(name)];
    return mime ? { path: expected, mime, bytes: entry.size } : null;
  } catch {
    return null;
  }
}

const ownedImage = (path: string, attachmentsDir: string): TurnImageInput | null =>
  ownedAttachment(path, attachmentsDir, OWNED_IMAGE_NAME, MIME_BY_EXTENSION, IMAGE_MAX_BYTES);
const ownedVideo = (path: string, attachmentsDir: string): TurnVideoInput | null =>
  ownedAttachment(path, attachmentsDir, OWNED_VIDEO_NAME, VIDEO_MIME_BY_EXTENSION, FILE_MAX_BYTES);

/**
 * Left where a replayed message's image was: the image itself rides on the current turn, so without this the model
 * reads an old screenshot as part of the latest message.
 */
export const REPLAYED_IMAGE_NOTE =
  "[An image was attached to this earlier message. It is attached again to this turn only so you can still see it; it is not new and was not sent with the latest message.]";

export interface ExtractTurnImagesOptions {
  attachmentsDir?: string;
  maxCount?: number;
  maxBytes?: number;
  maxVideoCount?: number;
  /** Text left in place of each admitted image tag. */
  imageNote?: string;
}

/**
 * Invalid tags stay visible as ordinary text and never become native image input. A video's <attached-file> tag
 * always stays in the text, so an engine that reads files still gets its path; sampled frames only add to it.
 */
export function extractTurnImages(
  text: string,
  options: ExtractTurnImagesOptions = {},
): { text: string; images: TurnImageInput[]; videos: TurnVideoInput[] } {
  if (!text.includes("<attached-image") && !text.includes("<attached-file")) return { text, images: [], videos: [] };

  const attachmentsDir = options.attachmentsDir ?? ATTACHMENTS_DIR;
  const maxCount = options.maxCount ?? TURN_IMAGE_MAX_COUNT;
  const maxBytes = options.maxBytes ?? TURN_IMAGE_MAX_BYTES;
  const maxVideoCount = options.maxVideoCount ?? TURN_VIDEO_MAX_COUNT;
  const candidates = attachmentTagCandidates(text);

  const admittedImages = candidates
    .filter((tag) => tag.kind === "image")
    .map((tag) => ({ tag, image: ownedImage(tag.path, attachmentsDir) }))
    .filter((item): item is { tag: TagCandidate; image: TurnImageInput } => item.image !== null);
  if (admittedImages.length > maxCount) {
    throw statusError(413, `Send no more than ${maxCount} images at a time`);
  }
  const aggregateBytes = admittedImages.reduce((total, item) => total + item.image.bytes, 0);
  if (aggregateBytes > maxBytes) {
    throw statusError(413, `Attached images exceed ${Math.floor(maxBytes / (1024 * 1024))} MB total`);
  }

  const videos = candidates
    .filter((tag) => tag.kind === "file")
    .map((tag) => ownedVideo(tag.path, attachmentsDir))
    .filter((video): video is TurnVideoInput => video !== null)
    .slice(0, maxVideoCount);

  let providerText = text;
  const removedTags = admittedImages.map((item) => item.tag).sort((a, b) => b.start - a.start);
  const note = options.imageNote ?? "";
  for (const tag of removedTags) providerText = providerText.slice(0, tag.start) + note + providerText.slice(tag.end);

  return { text: providerText, images: admittedImages.map((item) => item.image), videos };
}

export function extractHandoffMedia(text: string, followups: readonly string[], options: ExtractTurnImagesOptions = {}) {
  const first = extractTurnImages(text, options);
  const images = [...first.images], videos = [...first.videos], followupTexts: string[] = [];
  let bytes = images.reduce((sum, image) => sum + image.bytes, 0);
  for (const note of followups) {
    const media = extractTurnImages(note, options);
    bytes += media.images.reduce((sum, image) => sum + image.bytes, 0);
    if (images.length + media.images.length > (options.maxCount ?? TURN_IMAGE_MAX_COUNT)) throw statusError(413, "Too many images across this handoff");
    if (bytes > (options.maxBytes ?? TURN_IMAGE_MAX_BYTES)) throw statusError(413, "Attached images exceed the total byte limit for one turn");
    images.push(...media.images);
    videos.push(...media.videos.slice(0, Math.max(0, (options.maxVideoCount ?? TURN_VIDEO_MAX_COUNT) - videos.length)));
    followupTexts.push(media.text);
  }
  return { text: first.text, images, videos, followupTexts };
}

/** Stills sampled from a message's video, never taking a turn that already carries `earlier` images past its image count. */
export function videoFramesWithin(earlier: number, videos: readonly TurnVideoInput[]): Promise<TurnImageInput[]> {
  return videoFrameImages(videos, TURN_IMAGE_MAX_COUNT - earlier);
}

export function extractSteerImages(
  texts: readonly string[],
  options: ExtractTurnImagesOptions = {},
): { texts: string[]; images: TurnImageInput[] } | null {
  const maxCount = options.maxCount ?? TURN_IMAGE_MAX_COUNT;
  const maxBytes = options.maxBytes ?? TURN_IMAGE_MAX_BYTES;
  const resolved: string[] = [];
  const images: TurnImageInput[] = [];
  try {
    for (const text of texts) {
      const item = extractTurnImages(text, options);
      resolved.push(item.text);
      images.push(...item.images);
    }
  } catch {
    return null;
  }
  if (images.length > maxCount) return null;
  if (images.reduce((total, image) => total + image.bytes, 0) > maxBytes) return null;
  return { texts: resolved, images };
}

function replayEntryImages(text: string, copy: Message | undefined, options: ExtractTurnImagesOptions) {
  if (!copy) return extractTurnImages(text, options);
  if (copy.role !== "user" || !copy.text?.includes("<attached-image") || routedWorkMarker(copy)) return;
  const quoted = JSON.stringify(contextText(copy));
  if (!text.includes(quoted)) return;
  const media = extractTurnImages(copy.text, options);
  const marked = JSON.stringify(contextText({ ...copy, text: media.text }));
  return { images: media.images, text: text.replace(quoted, () => marked) };
}

export function extractReplayImages<T extends { id?: string; role: "user" | "assistant"; text: string }>(
  transcript: readonly T[],
  current: readonly TurnImageInput[],
  options: ExtractTurnImagesOptions & { history?: readonly Message[] } = {},
): { transcript: T[]; images: TurnImageInput[] } {
  let maxCount = (options.maxCount ?? TURN_IMAGE_MAX_COUNT) - current.length;
  let maxBytes = (options.maxBytes ?? TURN_IMAGE_MAX_BYTES) - current.reduce((total, image) => total + image.bytes, 0);
  const copies = new Map(options.history?.filter(message => message.workBotCopy).map(message => [message.id, message]));
  const replayed = [...transcript];
  const images: TurnImageInput[] = [];
  for (let index = replayed.length - 1; index >= 0 && maxCount > 0; index -= 1) {
    const entry = replayed[index]!;
    if (entry.role !== "user") continue;
    const item = replayEntryImages(entry.text, entry.id ? copies.get(entry.id) : undefined, { ...options, maxCount: Infinity, maxBytes: Infinity, imageNote: REPLAYED_IMAGE_NOTE });
    if (!item?.images.length) continue;
    const bytes = item.images.reduce((total, image) => total + image.bytes, 0);
    if (item.images.length > maxCount || bytes > maxBytes) break;
    replayed[index] = { ...entry, text: item.text };
    images.unshift(...item.images);
    maxCount -= item.images.length;
    maxBytes -= bytes;
  }
  return { transcript: replayed, images };
}
