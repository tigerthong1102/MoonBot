# StartupBot campaigns

The existing announcement parser, audience rules, once-per-card records, schedule, sponsor cooldown and notice queue are retained. The built-in upstream promotions are disabled. Provider integrations remain available for user-selected credentials.

Edit `announcements/announcements.json` using GitHub’s file editor or a local text editor. No application code changes are required for each campaign. The file currently contains no campaigns. Keep `version: 1`, update `updatedAt`, and add cards using the existing schema and guide in `docs/announcements.md`. Use a new stable card ID for a new campaign; its existing seen record prevents repeating an old campaign.

Set the title, body, HTTPS image and destination, start/end dates, primary/secondary actions and audience. Use only StartupBot-owned campaigns and approved services. Preview and validate with `node scripts/check-announcements.mjs`. Commit the content file to the feed source branch only after review. Installed clients refresh an enabled feed about hourly; clients with `OMB_DISABLE_ANNOUNCEMENTS=1` will not fetch it. No feed has been deployed or enabled on existing installations by this change.

The feed source is this fork’s `announcements/announcements.json` on `main`, not the upstream repository. Images must pass the existing source allowlist. Future infrastructure changes must preserve this ownership boundary, authorization, bounded parsing and required-action priority. Do not rename a provider to imply that StartupBot operates that provider.

Cached campaigns are accepted only when their stored source is this fork’s feed URL. Unscoped or upstream caches are ignored, even offline, so an old upstream sponsor card cannot outlive the rebrand. New owner campaigns keep normal bounded offline caching and dismissal behavior.
