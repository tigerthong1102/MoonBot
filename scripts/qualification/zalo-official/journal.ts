import { openZaloPrivateDatabase } from "../../../server/zalo-private-database.ts";

export const openLabJournal = (home: string) => openZaloPrivateDatabase(home, "receipts.sqlite");
