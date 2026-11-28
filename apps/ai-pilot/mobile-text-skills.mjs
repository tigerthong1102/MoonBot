import { readFileSync } from "node:fs";

function catalogSection(name, first, next) {
  const file = new URL("../../skills/catalog/" + name + "/SKILL.md", import.meta.url);
  const source = readFileSync(file, "utf8");
  const start = source.indexOf("\n## " + first + "\n");
  const end = source.indexOf("\n## " + next + "\n", start + 1);
  if (start < 0 || end <= start || end - start > 8192) throw new Error("Invalid bundled mobile skill: " + name);
  return source.slice(start, end).trim();
}

export function mobileTextSkills() {
  return new Map([
    ["chat", ""], ["write", "Help draft the requested text."],
    ["translate", "Translate only the supplied text into the language requested. Ask for the target language when missing."],
    ["summarize", "Summarize only the text supplied by the user. Ask for the text when missing."],
    ["campaign-plan", catalogSection("campaign-plan", "Inputs", "Planning Reference")],
    ["draft-outreach", catalogSection("draft-outreach", "Step 3 - Draft the email", "Step 4 - Create the draft")],
  ]);
}
