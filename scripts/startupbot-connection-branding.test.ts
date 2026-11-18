import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

const retired = /(?:openmausbot|mausbot|omb[-_])/i;
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "server", "electron", "scripts/mcp-server.ts"], { encoding: "utf8" })
  .split("\n").filter(file => /\.(?:[cm]?js|ts)$/.test(file) && !/(?:\.test\.|\.node-test\.|\/testing\/|\.d\.ts$)/.test(file));

const text = (node: ts.Expression): string | null => ts.isStringLiteralLike(node) ? node.text
  : ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => span.literal.text).join("") : null;

describe("StartupBot connection identity", () => {
  it("does not advertise retired client/server names in MCP, ACP or OAuth metadata", () => {
    const found: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const check = (node: ts.Expression) => {
        const value = text(node);
        if (value && retired.test(value)) found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${value}`);
      };
      const metadata = (node: ts.Expression) => {
        if (!ts.isObjectLiteralExpression(node)) return;
        for (const field of node.properties) if (ts.isPropertyAssignment(field) && field.name.getText(source) === "name") check(field.initializer);
      };
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node)) {
          const key = node.name.getText(source);
          if (["clientInfo", "serverInfo"].includes(key)) metadata(node.initializer);
          if (["client_name", "agent_name_hint", "software_name", "application_name"].includes(key)) check(node.initializer);
        }
        if (ts.isVariableDeclaration(node) && node.initializer) {
          if (node.name.getText(source) === "CLIENT_INFO") metadata(node.initializer);
          if (node.name.getText(source) === "DISCOVERY_CLIENT_NAME") check(node.initializer);
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "initialize" && node.arguments[0]) check(node.arguments[0]);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(found).toEqual([]);
  });
});
