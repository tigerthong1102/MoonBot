export const READ_ADAPTER_VERSION = 1;
export const READ_ADAPTERS = {
  gmail: {
    provider: "composio", files: false,
    operations: ["GMAIL_FETCH_EMAILS", "GMAIL_GET_PROFILE", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID"],
  },
  googlecalendar: {
    provider: "composio", files: false,
    operations: ["GOOGLECALENDAR_EVENTS_LIST", "GOOGLECALENDAR_LIST_CALENDARS"],
  },
  outlook: {
    provider: "composio", files: false, operations: ["OUTLOOK_LIST_MESSAGES", "OUTLOOK_GET_MESSAGE"],
  },
} as const;

export type ReadApp = keyof typeof READ_ADAPTERS;

export function readAdapterFor(slug: string): ReadApp {
  for (const app of Object.keys(READ_ADAPTERS) as ReadApp[]) {
    if ((READ_ADAPTERS[app].operations as readonly string[]).includes(slug)) return app;
  }
  throw new Error("The background read adapter does not grant this operation.");
}
