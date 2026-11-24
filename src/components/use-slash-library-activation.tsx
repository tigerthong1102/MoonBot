import { useEffect, useRef, useState } from "react";
import type { ComposerSlashCommand } from "@/lib/composer-commands";
import { t } from "@/lib/i18n";
import { activateLibrarySkill } from "@/lib/library-skill-use";
import { api } from "@/state/api";
import { Layer } from "./Layer";
import { SkillSourceDialog } from "./SkillSourceDialog";

interface Review {
  skill: { name: string; warnings: string[] };
  text: string;
  review: true;
  done: () => void;
}

export function useSlashLibraryActivation(
  botId: string | undefined,
  threadId: string,
  reportError: (message: string) => void,
) {
  const active = useRef(true);
  const busy = useRef(false);
  const [review, setReview] = useState<Review | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const activate = async (name: string, enabled: boolean, done: () => void, inReview = false) => {
    if (!botId || busy.current) return;
    busy.current = true;
    setWorking(true);
    setError("");
    try {
      await activateLibrarySkill({ botId, threadId }, { name, enabled });
      if (active.current) {
        setReview(null);
        done();
      }
    } catch (cause) {
      if (active.current) {
        const message = cause instanceof Error ? cause.message : t("skills.library.unavailable");
        if (inReview) setError(message);
        else reportError(message);
      }
    } finally {
      busy.current = false;
      if (active.current) setWorking(false);
    }
  };

  const pick = async (command: Extract<ComposerSlashCommand, { kind: "skill" }>, done: () => void) => {
    if (!command.activate || busy.current) return;
    if (command.activate.enabled) return activate(command.id, true, done);
    busy.current = true;
    setWorking(true);
    setError("");
    try {
      const { text } = await api<{ text?: string }>(`/api/skills-library/${encodeURIComponent(command.id)}`);
      if (!text) throw new Error(t("skills.error.contentsImport"));
      if (active.current) setReview({ skill: { name: command.id, warnings: command.activate.warnings }, text, review: true, done });
    } catch (cause) {
      if (active.current) reportError(cause instanceof Error ? cause.message : t("skills.error.load"));
    } finally {
      busy.current = false;
      if (active.current) setWorking(false);
    }
  };

  return {
    pick, pending: working || Boolean(review),
    dialog: review && (
      <Layer modal>
        <SkillSourceDialog viewing={review} error={error} working={working}
          onClose={() => { if (!busy.current) setReview(null); }} enableLabel={t("skills.library.enableAndUse")}
          onEnable={() => void activate(review.skill.name, false, review.done, true)} />
      </Layer>
    ),
  };
}
