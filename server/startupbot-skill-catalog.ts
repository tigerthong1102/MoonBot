import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isSkillName } from "../shared/skill-md.ts";
import { prepareSkillFolder, type SkillFolderFile } from "./skill-folder.ts";
import { installBundledLibrarySkills, readSkillLibraryIndex, retireLibrarySkill, skillsLibraryRoot } from "./skill-library.ts";

// Replace only verified copies of these bundled folders with superseded scripts.
const supersededFolders = new Map([
  ["1512551101efbe5322e6a35df68b5a56aac557427fffa3640b2923b74619cc21", "hyperframes"],
  ["01c22af835fc241d9de847cacca5b61d22de67ba54cd2951df39484ad891807b", "hyperframes-cli"],
  ["f2a06185c507f61a1665bdb27509c1eb9ec1dc95e604e280b669ec178d2663b2", "media-use"],
  ["a757fb78a1e1e543212e70068ec3e5c59beb96758666dae4fac4aad6f146660a", "media-use"],
  ["226eb0a4300ceb9b4b26efec68740cce694bfc13da9153f2da74b6ea7c4a58d1", "hyperframes"],
  ["03e73f96b82124f1a13ba82c56d86ed3fa1a09ce4ee1f9bb8b0fbba88c4a9294", "media-use"],
  ["988fc22ebfebc90afb8e0d6fd03049d52d9c039dd173c9b93dc4b96f785c4f58", "hyperframes"],
  ["1dff97bbde66b5b4af3d14c5aab56499d6742c5c1a23e80c0a88c4c0a2b2e999", "hyperframes"],
  ["759e4397580408711937ca57322c7c35ad026cc070c98b8deb2595ec037065e6", "pptx"],
  ["8826653319762358dc0f9dabe7c67a7bcaeed76731b548ddc23fb5240aef599a", "shopify"],
  ["6e6c4c82bbfd31bcb3442df6fc54e5c977b15ff9a1d093947802b2add7db8326", "woocommerce"],
  ["1f3d841fc7b35f063cd303ca492cd89a425b91f4179334b3a56adf534580f946", "product-discovery"],
  ["2d9a3bd52658ae4f404765af66054acaf792243e1af1dfc053b3106310348b4d", "pricing-strategy"],
  ["e1997bc481016aef4afccaca7a5ae536921513bf76ba353e9a97944073554ddd", "business-finance-fundamentals"],
  ["3dddb7b1a4a99b6111f1889af08f0bdae1b1b12a6864b04703ac482e7282b087", "team-leadership"],
  ["2e3be027f72ff7bc60a4b1cba431a3515021f589a26069d03dc7dc604a29b946", "startup-idea"],
  ["e03bf7d4addfce4ad653f6b50b9cc86bcc87193f31d1db62fa6398042bf762d0", "web-perf"],
  ["d88c9f21c85e0866cfd1dd35970eca248dd8bf13f5b5b99d9efba27705c014ab", "gemini-api"],
  ["5ac09c9a192939c57cf3e05c6a623ac6e521616926044245fbf6f34243d4a3ca", "producthunt"],
  ["07b62f68d600a9e3561f91133969587be1d2a8493dc11b7902454432dc6d4fca", "hyperframes"],
  ["b79c22ecb6679835c84e70cc8813fabf3df957bdb1dc09ad9a66b8373ec7fc3e", "comps-analysis"],
  ["29b7d808e8e049759e82ccbedb10999ec9149669716bda064fab55cc25cbad4c", "byted-text-to-speech"],
  ["0afa47ef879ebebe3f571aa8ac7f9b1775583ff273dcb52c1168996724ae417d", "gemini-api"],
  ["8b4e269e1d88ef696d7fd5758039967c5f8df58f282612ebc5a9d73adce22df4", "apify-ecommerce"],
  ["dafedc743725177cab814c9c556e31499cdb83e53540886617654ed1dc413c66", "hyperframes"],
  ["07b62f68d600a9e3561f91133969587be1d2a8493dc11b7902454432dc6d4fca", "hyperframes"],
  ["b93a65ef1e361e7df9d837b029cbae8841365bed363c4e0a82c8726796c0b069", "producthunt"],
  ["adfa8a000dc22d041f444be9a841c075dec76c0a9edd0091da23159013249757", "docx"],
  ["3b0ee778f53c9fbf88d64b026b233321180aeecfd93713ebe3c9623b59c47ab6", "pptx"],
  ["3fdea15edd601b3c15b7bb7667f78084df7ab6f50f388509932cf5bc0db6abe6", "xlsx"],
  ["d2639c68a8a93b0e8ed6e4f22982529ed613658cece6ac36e12e46ff25da9086", "web-perf"],
  ["551f55a60606b93e5e54f8ef068a3b663dd2492c62c61e083e25c05ee7cf5d08", "hyperframes"],
  ["37911cfa907a24a4245749004bb67702596575919690346aac2e9f3e69feeeb0", "hyperframes-cli"],
  ["da737541f5d48d0507fc53b35b09e202732161ccedc5b9567dda8794105ad72f", "xlsx"],
  ["54810feb5ba0cfbbb5d78687e5874c39bb654986170763b36eb384826ad25a60", "byted-seedream-image-generate"],
  ["254bbe7ac0c66175299609d72e4a7baf073891c8b3ed627c9970b03ce12fa010", "pdf"],
  ["0790c7154973a0da99d5d182bb23ffc66e2f3aa5b1a00d519ee842d6f39e9001", "byted-seedance-video-generate"],
  ["bae1fee03ea09067461c2f436a211a0f8ff7e6178356f81a6f61ccb04a3fd706", "pdf"],
  ["b2d2e4e5a884469a63ae0abef7d0e95d756b70619f94736fd9b62efe34895f98", "dcf-model"],
  ["5a0400264fe9b7e20522ff39ab59535636b98a182448e641798554ef5d988f11", "webapp-testing"],
  ["ad2bd0eecf45c277877237eeb0096898e0e727dddf66dc7d3fd8d2e03b4399cf", "byted-seedream-image-generate"],
  ["eb6a7f5467bcf0a501a2a167579ac67fcf079286441da74a1fc1bddce96aafcd", "gemini-api"],
  ["ae82d7517dd3ce785e8accd1f7fa6db578cf7463ea433d125c68b83cda02aa2f", "google-ads-api-mcp-setup"],
  ["4b05cb5da04db473ba937c62740d48176b20dc7b0c3e3236eb66be8056280ccd", "byted-las-asr-pro"],
  ["09ff3e6d799ed113ea3c2dd725d3e960bcae80cfeb1d35d53d6dc745ea6c8f7f", "byted-las-pdf-parse-doubao"],
  ["826bac3c4d01452e2fde4d5860f923f0c47458cb55c46799276c40481c6141c5", "generated-ui"],
  ["864db9a552416a5b9ae7361fa95bdcaa323920d5a8ecc95ac3013dc213cf468e", "producthunt"],
  ["4f52c9b2aad501afefdf935c1e08b091f41ff6a4a0ad1a6fcb4eebf6105c7b69", "pptx"],
  ["1df4f729a62b6d2ed8c7987dfd542d8e0b4ecd45cb7e431cb751dd4288dae9e2", "byted-seedance-video-generate"],
  ["718e9e770cc11c9ef01850e10f4d46926f6540dbdc12f542b5ddc86e3940ca70", "byted-seedream-image-generate"],
]);

const olderInstructions = new Map([
  ["comps-analysis", "a6dad79f70eac93dffde0a3b09f7ee009f2e37035668d0818022fbc499b42698"],
  ["byted-text-to-speech", "5a2f18debb6cf3a695330256266b59550870a515bbae0949ab9141c8af239343"],
  ["gemini-api", "0df7c28dcf9f8d17105ab1955bd07d14bd8c58e9364fc40b045cddfd1149a7f0"],
  ["apify-ecommerce", "f7aac4c3f6e22301ff97192adad7253cb51c826c17cce07b14fa32638aa3fedf"],
  ["producthunt", "d1714f2ece2962d1f836cb12e2b57f6f017d7a0b053f86b102b42cab9ae1b638"],
  ["docx", "a100df67e78f4a30ce32a95abcaf02d4418013924f9d15f72e78fe52ca439020"],
  ["pptx", "7cc3d0066b6036227241edb9ff640ce7aa22781c34530f9550d69651c7a5cea2"],
  ["xlsx", "c5c862d6d8ae4b9a7bed37c5a16f24d9415747479dd535fb7ca6011fa4d71cb0"],
  ["web-perf", "ae0d9419aff36834233b865243c3eea06ade6fa74b0951680174f11647014f18"],
  ["hyperframes", "afe67b17e26fb9d3132da33ff9143f79025da60dd9da123aad7feeb81684fbf2"],
  ["hyperframes-cli", "93b586ee1f828a0b02326e730ac0bc3916ed6e0b909077d8300ee0080b21be27"],
  ["byted-seedream-image-generate", "9f525c94dd91cedae6507002f875266645a732134967e63f09d230ba4e3367cb"],
  ["generated-ui", "ee2543eb7ddbe3fda74a9d60dca4f66e18583024ac82d08793843b1df4446812"],
  ["byted-seedance-video-generate", "0ad5a085009ba9da06229c0e19f6383e2092cf17439d0a6b3a7bce9642149189"],
]);

const additionalOlderInstructions = new Map([
  ["hyperframes-cli", new Set(["101462e6097bc2cc0e9872b164c676a15f4f77b0e52bee99d7c944d6a1eab557"])],
  ["web-perf", new Set(["1b7adf5eda4c29466fee9a9b4cda2782fa3be821b899b5f9630191541ea2115a"])],
  ["gemini-api", new Set(["218ce9d59ac461078788458a0f5f8f2ef6109d3386d5bd1468a8036ab3471742", "7b7453f9d9db260b4a0a8e20a14c2fab1a10b148952f55fe0b47a1211f7fcf8f"])],
  ["google-ads-api-mcp-setup", new Set(["91131558e35560aafff656d605c0dee78bfd4ac429e1ca4f94c7211e0e982af3"])],
  ["byted-las-asr-pro", new Set(["e8b30070e07dbe4ffd2dfb4ccc499d64fd52c64cfb2ae70bdf85e8d28d51a530"])],
  ["byted-las-pdf-parse-doubao", new Set(["9b7b9bfa212311a356999d9e00db4e46c6e218f05af10fe00bf773e867a8c677"])],
  ["producthunt", new Set(["2315e20b037b237a45b2818a993af3c9df3ac18e4ba18678a3f7189cf1e00ef3"])],
  ["pptx", new Set(["fe5e12c18ff824da4ec41527e0a0035e4b6825c6dfeba0219b3e9543bb4106ef", "29405467d70f30b2ee3b2ad312bedbe16005061d2dac684eea2c80df0b95abcd"])],
  ["byted-seedream-image-generate", new Set(["6197608c6cca5877c44cafee20f0aca138d3c0ab56acb754809c149a773e35a1"])],
  ["hyperframes", new Set([
    "08c71637864ffb4f1df7667377505e04cdf2f29986fafdfe8c0b2f822d3b377c",
    "0a2f50a464c4b81f7ff433ad719a941d482fad10e75073976e4d685c1426ff18",
    "02ed02e7c4aa04cb65cd06630255b73d1e9727b1f6790df6c5d00512a7b91a73",
    "37fe24371f4a1ef2be2c2e6feeb3c7d1d45c177db5a508a83177080d26226dcd",
    "5b3f2384088aae01eaf835ec1588128387432f7ddc112321f80dfa22b3ab7880",
    "11a2302d7b7d522d9878047c13e49ab92bec990dd8094136b51b9c7cbda44c4c",
    "6c35bb338eb62f222c950d878f8702de8baceff21a0b1c2b1c6462a44e118bf5",
    "10698cf5da02376e480b02939cc7e8ec72fc8701d8d3630effb01c0090954937",
  ])],
]);

const catalogSchema = z.array(z.object({
  name: z.string().refine(isSkillName),
  source: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }),
  license: z.literal("Apache-2.0"),
}));

function readCatalogFolder(directory: string, prefix = ""): SkillFolderFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return readCatalogFolder(path, relative + "/");
    if (!entry.isFile()) throw new Error(`invalid catalog file: ${relative}`);
    return [{ path: relative, content: readFileSync(path) }];
  });
}

export function installStartupBotSkillCatalog({
  catalog = join(process.env.OMB_SKILLS_DIR || join(process.cwd(), "skills"), "catalog"),
  root = skillsLibraryRoot(),
} = {}): { installed: number; failed: string[] } {
  let source: string;
  try {
    source = readFileSync(join(catalog, "index.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { installed: 0, failed: [] };
    throw error;
  }
  const entries = catalogSchema.parse(JSON.parse(source));
  if (new Set(entries.map(({ name }) => name)).size !== entries.length) {
    throw new Error("duplicate names in the StartupBot skill catalog");
  }

  const existing = readSkillLibraryIndex(root);
  const pending: Parameters<typeof installBundledLibrarySkills>[0][number][] = [];
  const failed: string[] = [];
  for (const entry of entries) {
    const previous = Object.hasOwn(existing, entry.name) ? existing[entry.name] : undefined;
    if (previous && (previous.source !== entry.source || !previous.filesSha256 ||
        entry.name !== supersededFolders.get(previous.filesSha256))) continue;
    try {
      const folder = prepareSkillFolder(readCatalogFolder(join(catalog, entry.name)));
      if ("error" in folder) throw new Error(folder.error);
      if (folder.skipped.length || folder.parsed.name !== entry.name ||
          !folder.files.some(({ path }) => path === "LICENSE")) {
        throw new Error("catalog name, files or license do not match the package");
      }
      if (previous) {
        const expected = olderInstructions.get(entry.name) ?? createHash("sha256").update(folder.skillMd).digest("hex");
        if (previous.sha256 !== expected && !additionalOlderInstructions.get(entry.name)?.has(previous.sha256)) continue;
        const archived = retireLibrarySkill(entry.name, previous.sha256, root);
        if ("error" in archived) throw new Error(archived.error);
        if ("stale" in archived) continue;
      }
      pending.push({
        ...entry,
        instructions: folder.skillMd,
        compatibility: folder.parsed.compatibility,
        warnings: folder.warnings,
        files: folder.files,
        reviewState: ["media-use", "shopify", "woocommerce", "product-discovery", "pricing-strategy", "business-finance-fundamentals", "team-leadership", "startup-idea", "comps-analysis", "hyperframes", "hyperframes-cli", "web-perf", "xlsx", "docx", "pptx", "producthunt", "apify-ecommerce", "gemini-api", "byted-text-to-speech", "google-ads-api-mcp-setup", "byted-las-asr-pro", "byted-las-pdf-parse-doubao", "generated-ui", "byted-seedance-video-generate", "byted-seedream-image-generate"].includes(entry.name)
          ? previous?.reviewState ?? "disabled"
          : "disabled",
        everyBot: previous?.everyBot,
      });
    } catch (error) {
      failed.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const result = installBundledLibrarySkills(pending, root);
  return { installed: result.installed, failed: [...failed, ...result.failed] };
}

export function seedStartupBotSkillCatalog(): void {
  try {
    const { installed, failed } = installStartupBotSkillCatalog();
    if (installed) console.log(`[skills-library] added ${installed} catalog skills for review`);
    for (const failure of failed) console.warn(`[skills-library] catalog: ${failure}`);
  } catch (error) {
    console.error(`[skills-library] catalog could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}
