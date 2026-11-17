import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import en from "../src/locales/en.json" with { type: "json" };
import { settingsPlacesFile } from "../src/components/settings/settings-places.ts";

writeFileSync(fileURLToPath(new URL("../shared/settings-places.ts", import.meta.url)), settingsPlacesFile(en));
