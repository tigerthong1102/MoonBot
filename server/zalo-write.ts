import type { DatabaseSync } from "node:sqlite";

export function zaloWrite<T>(db: DatabaseSync, operation: () => T): T {
  const nested = db.isTransaction;
  db.exec(nested ? "SAVEPOINT zalo_write" : "BEGIN IMMEDIATE");
  try {
    const value = operation();
    db.exec(nested ? "RELEASE zalo_write" : "COMMIT");
    return value;
  } catch (error) {
    db.exec(nested ? "ROLLBACK TO zalo_write; RELEASE zalo_write" : "ROLLBACK");
    throw error;
  }
}
