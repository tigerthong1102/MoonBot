import type { LocaleKey } from "../locales";

export type MessageKey = Extract<LocaleKey, `reconcile.${string}`>;
type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export class ReconcileError extends Error {
  side?: "left" | "right";

  constructor(readonly key: MessageKey, readonly params?: Params, readonly field?: "company" | "document" | "period") {
    super(key);
  }
}

export function errorText(error: unknown, t: Translate) {
  if (!(error instanceof ReconcileError)) return t("reconcile.unreadable");
  const params = error.field ? { ...error.params, field: t(`reconcile.${error.field}`) } : error.params;
  const message = t(error.key, params);
  return error.side ? t(`reconcile.${error.side}`) + " — " + message : message;
}
