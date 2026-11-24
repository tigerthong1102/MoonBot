const APP_LABELS: Record<string, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googlesheets: "Google Sheets",
  googledocs: "Google Docs",
  googledrive: "Google Drive",
  googleslides: "Google Slides",
  slack: "Slack",
  github: "GitHub",
  notion: "Notion",
  linear: "Linear",
  sentry: "Sentry",
  posthog: "PostHog",
  discord: "Discord",
  twitter: "X",
  reddit: "Reddit",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  jira: "Jira",
  asana: "Asana",
  trello: "Trello",
  dropbox: "Dropbox",
  airtable: "Airtable",
  figma: "Figma",
  stripe: "Stripe",
  outlook: "Outlook",
  microsoftteams: "Microsoft Teams",
  zoom: "Zoom",
};

/** The plain app tool names bots call on every engine (gmail.search_emails, or gmail_search_emails where a dot is refused). */
export const PLAIN_APP_TOOL = /^(gmail|googlecalendar|googlesheets|googledocs|googledrive|slack|github|notion|linear)[._]([a-z][a-z0-9_]*)$/;

export function appLabel(slug: string): string {
  const key = slug.toLowerCase();
  if (Object.hasOwn(APP_LABELS, key)) return APP_LABELS[key]!;
  const words = slug.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : slug;
}

/** An app action that names no thing ("batch get", "list"): it reads from the app. */
export const BARE_READ = /^(?:batch |bulk )?(?:get|read|fetch|list|query|search|lookup|retrieve)$/;
