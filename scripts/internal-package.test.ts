import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("StartupBot internal distribution boundary", () => {
  it("requires manual dispatch and grants no publication permission", () => {
    const workflow = parse(read(".github/workflows/package-linux.yml"));
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.package.if).toBe("${{ !inputs.desktop }}");
    for (const name of ["macos", "windows"]) {
      const job = workflow.jobs[name];
      expect(job.if).toBe(`inputs.desktop && (inputs.desktop_os == 'all' || inputs.desktop_os == '${name}')`);
      expect(JSON.stringify(job)).not.toMatch(/secrets\.|gh release|packages:\s*write|contents:\s*write/);
      expect(job.steps.find((step: { run?: string }) => step.run?.includes("electron-builder")).run).toContain("--publish never");
      expect(job.steps.find((step: { run?: string }) => step.run?.includes("smoke-browser-bundle.mjs")).run).not.toContain("--resources release/");
      const smoke = job.steps.findIndex((step: { run?: string }) => step.run?.includes("smoke-internal-desktop.mjs"));
      const metadata = job.steps.findIndex((step: { run?: string }) => step.run?.includes("internal-build-metadata.mjs"));
      const upload = job.steps.findIndex((step: { uses?: string }) => step.uses?.startsWith("actions/upload-artifact"));
      expect(smoke).toBeGreaterThan(-1);
      expect(metadata).toBeGreaterThan(smoke);
      expect(upload).toBeGreaterThan(metadata);
      expect(job.steps[upload].if).toBeUndefined();
    }
  });

  it("uses independent identity and the supplied logo without changing upstream attribution", () => {
    const builder = parse(read("electron-builder.yml"));
    const internal = parse(read("electron-builder.internal.yml"));
    expect(builder.appId).toBe("ai.startupbot.desktop");
    expect(builder.productName).toBe("StartupBot");
    expect(builder.mac.icon).toBe("build/startupbot.icns");
    expect(builder.win.icon).toBe("build/startupbot.ico");
    expect(internal.extraMetadata.name).toBe("startupbot");
    expect(internal.extraMetadata.homepage).toBe("https://startupbot.ai");
    expect(internal.mac.identity).toBe("-");
    expect(internal.dmg.sign).toBe(false);
    expect(builder.extraResources).toEqual(expect.arrayContaining([
      { from: "LICENSE", to: "licenses/OpenMausBot-LICENSE.txt" },
      { from: "NOTICE", to: "licenses/OpenMausBot-NOTICE.txt" },
    ]));
    expect(builder.publish).toEqual([{ provider: "github", owner: "tigerthong1102", repo: "StartupBot" }]);
  });
});
