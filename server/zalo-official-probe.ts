import { createZaloOfficialReader, ZaloOfficialError } from "./zalo-official.ts";

async function main() {
  const reader = createZaloOfficialReader(
    process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID ?? "",
    process.env.STARTUPBOT_ZALO_OFFICIAL_BOT_TOKEN ?? "",
  );
  const status = await reader.probe();
  process.stdout.write(JSON.stringify({ identityVerified: true, webhookConfigured: status.webhookConfigured }) + "\n");
}

void main().catch((error: unknown) => {
  process.stderr.write((error instanceof ZaloOfficialError ? error.code : "probe-failed") + "\n");
  process.exitCode = 1;
});
