import "server-only";

import path from "node:path";

import Database from "better-sqlite3";

const resolvedDbPath =
  process.env.SB_DB_PATH ?? path.resolve(process.cwd(), "..", "data", "sb.sqlite");

let dbInstance: Database.Database | null = null;

export function getDbPath(): string {
  return resolvedDbPath;
}

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = new Database(resolvedDbPath, {
    readonly: true,
    fileMustExist: true,
  });

  return dbInstance;
}
