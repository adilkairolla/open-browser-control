import { Database, type Collection, type DatabaseSpec } from "../storage/idb.ts";
import type { Conversation, StoredMessage } from "./types.ts";

const DB_SPEC: DatabaseSpec = {
  name: "obc",
  version: 1,
  stores: [
    { name: "conversations", keyPath: "id", indexes: [{ name: "updatedAt", keyPath: "updatedAt" }] },
    { name: "messages", keyPath: "id", indexes: [{ name: "conversationId", keyPath: "conversationId" }] },
  ],
};

export interface SessionsDb {
  conversations: Collection<Conversation>;
  messages: Collection<StoredMessage>;
}

/** Open the chat-history database. Pass a factory in tests (fake-indexeddb). */
export function openSessionsDb(factory?: IDBFactory): SessionsDb {
  const db = factory ? new Database(DB_SPEC, factory) : new Database(DB_SPEC);
  return {
    conversations: db.collection<Conversation>("conversations"),
    messages: db.collection<StoredMessage>("messages"),
  };
}
