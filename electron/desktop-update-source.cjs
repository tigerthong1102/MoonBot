const feedUrl = "https://github.com/tigerthong1102/MoonBot/releases/latest/download";

function updateFeed(arch) {
  if (!["x64", "arm64"].includes(arch)) throw new Error("Unsupported StartupBot update architecture");
  return { provider: "generic", url: feedUrl, channel: `stable-${arch}` };
}

module.exports = { updateFeed };
