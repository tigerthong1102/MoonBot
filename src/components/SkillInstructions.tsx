import { useEffect, useState } from "react";
import { activeLocale, t } from "@/lib/i18n";

const originals = import.meta.glob<string>("../../skills/catalog/*/SKILL.md", {
  query: "?raw", import: "default",
});
const translations = import.meta.glob<string>("../../skills/catalog-locales/*/*.md", {
  query: "?raw", import: "default",
});

interface Translation {
  original: string;
  text: string;
  locale: string;
  name: string;
}

export function SkillInstructions({ name, text, label }: { name: string; text: string; label: string }) {
  const locale = activeLocale();
  const [local, setLocal] = useState<Translation | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => {
    const load = translations[`../../skills/catalog-locales/${locale}/${name}.md`];
    const original = originals[`../../skills/catalog/${name}/SKILL.md`];
    if (!load || !original) return;
    let cancelled = false;
    void Promise.all([original(), load()]).then(([bundled, translated]) => {
      if (!cancelled && bundled.replaceAll("\r\n", "\n") === text.replaceAll("\r\n", "\n")) {
        setLocal({ original: text, text: translated, locale, name });
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [locale, name, text]);

  const translated = local?.name === name && local.locale === locale && local.original === text ? local.text : undefined;
  return (
    <>
      {translated && (
        <button type="button" onClick={() => setShowOriginal(!showOriginal)}
          className="mt-2 self-start rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
          {showOriginal ? t("skills.library.showTranslation") : t("skills.library.showOriginal")}
        </button>
      )}
      <pre tabIndex={0} aria-label={label} lang={translated && !showOriginal ? locale : undefined}
        className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-inset p-3 font-mono text-[12px] leading-relaxed text-ink">
        {translated && !showOriginal ? translated : text}
      </pre>
    </>
  );
}
