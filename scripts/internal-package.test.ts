import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("StartupBot internal distribution boundary", () => {
  it("requires manual dispatch and grants no publication permission", () => {
    const workflow = parse(read(".github/workflows/package-linux.yml"));
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.on.workflow_dispatch.inputs.macos_runner.options).toEqual(["macos-26-intel", "macos-26"]);
    expect(workflow.jobs.macos["runs-on"]).toBe("${{ inputs.macos_runner || 'macos-26-intel' }}");
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

  it("verifies lossless payloads and gives each Mac architecture a separate download", () => {
    const workflow = parse(read(".github/workflows/package-linux.yml"));
    const mac = workflow.jobs.macos.steps;
    const compression = mac.findIndex((step: { run?: string }) => step.run?.includes("compress-mac-images.mjs"));
    const install = mac.findIndex((step: { name?: string }) => step.name === "Test the installed DMG on its native host");
    expect(compression).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(compression);
    expect(mac[install].run).toContain("package-payload.mjs");
    const uploads = mac.filter((step: { uses?: string; if?: string }) => step.uses?.startsWith("actions/upload-artifact") && !step.if);
    expect(uploads.map((step: { with: { path: string } }) => step.with.path)).toEqual(["release/downloads/arm64/", "release/downloads/x64/"]);
    expect(uploads.every((step: { with: { "compression-level": number } }) => step.with["compression-level"] === 0)).toBe(true);
    expect(workflow.jobs.windows.steps.find((step: { name?: string }) => step.name === "Install EXE and test the installed application").run).toContain("package-payload.mjs");
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
    expect(internal.compression).toBe("maximum");
    expect(internal.nsis.differentialPackage).toBe(false);
    expect(builder.nsis.differentialPackage).toBeUndefined();
    expect(internal.dmg.format).toBe("UDZO");
    expect(builder.extraResources).toEqual(expect.arrayContaining([
      { from: "LICENSE", to: "licenses/OpenMausBot-LICENSE.txt" },
      { from: "NOTICE", to: "licenses/OpenMausBot-NOTICE.txt" },
    ]));
    expect(builder.publish).toEqual([{ provider: "github", owner: "tigerthong1102", repo: "StartupBot" }]);
  });
});
