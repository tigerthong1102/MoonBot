import type { Dispatch } from "react";
import type { Action } from "@/state/store";
import type { CloudSource } from "./cloud-plan";
import { t } from "./i18n";

export function openUserSignIn(dispatch: Dispatch<Action>, source: CloudSource) {
  const personal = window.ogb?.personalAccount;
  if (!personal) {
    dispatch({ type: "openCloudAdd", source, signIn: true });
    return;
  }
  dispatch({ type: "toggleAppSettings", open: true, section: "account" });
  void personal.open().catch(() => dispatch({ type: "error", message: t("settings.account.connectionFailed") }));
}
