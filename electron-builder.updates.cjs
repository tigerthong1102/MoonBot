const { updateFeed } = require("./electron/desktop-update-source.cjs");

const arch = process.env.STARTUPBOT_SIGNED_ARCH;
const target = `${process.platform}-${arch}`;
const publisher = process.env.STARTUPBOT_SIGNED_PUBLISHER;
const publish = updateFeed(arch);
if (!["win32", "darwin"].includes(process.platform)) throw new Error("Build signed desktop updates on the target OS");
if (process.platform === "win32" && !publisher) throw new Error("Missing Authenticode publisher");

module.exports = {
  extends: "./electron-builder.customer.yml",
  publish: null,
  extraMetadata: { startupbotUpdate: { target, ...(process.platform === "win32" && { publisher }) } },
  mac: { publish, artifactName: "StartupBot-${version}-${arch}.${ext}" },
  win: { publish, ...(publisher && { signtoolOptions: { publisherName: [publisher] } }) },
  nsis: { artifactName: "StartupBot-${version}-${arch}-setup.${ext}" },
};
