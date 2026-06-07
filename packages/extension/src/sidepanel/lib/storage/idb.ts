/**
 * Domain-free IndexedDB helpers. A `Database` declares its stores + indexes once
 * and hands out typed `Collection<T>` handles. No app types live here — this is a
 * reusable record store (conversations, messages, skills, memory, …).
 */

export interface IndexSpec {
  name: string;
  keyPath: string;
  unique?: boolean;
}

export interface StoreSpec {
  /** Object store name. */
  name: string;
  /** Property used as the primary key (records must carry it). */
  keyPath: string;
  indexes?: IndexSpec[];
}

export interface DatabaseSpec {
  name: string;
  version: number;
  stores: StoreSpec[];
}

export class Database {
  private dbp?: Promise<IDBDatabase>;

  constructor(
    private readonly spec: DatabaseSpec,
    private readonly factory: IDBFactory = indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbp) {
      const p = new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory.open(this.spec.name, this.spec.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const store of this.spec.stores) {
            if (db.objectStoreNames.contains(store.name)) continue;
            const os = db.createObjectStore(store.name, { keyPath: store.keyPath });
            for (const idx of store.indexes ?? []) {
              os.createIndex(idx.name, idx.keyPath, { unique: idx.unique ?? false });
            }
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      // Never cache a rejected open — a transient failure would otherwise brick
      // every future operation. Drop the cache so the next call can retry.
      p.catch(() => {
        if (this.dbp === p) this.dbp = undefined;
      });
      this.dbp = p;
    }
    return this.dbp;
  }

  collection<T>(store: string): Collection<T> {
    return new Collection<T>(this, store);
  }

  /**
   * Delete every record matching an index value, atomically in a SINGLE
   * transaction (a cursor walk), so a concurrent write can't slip a new matching
   * record between a key scan and the deletes.
   */
  async deleteByIndex(store: string, index: string, value: IDBValidKey): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite");
      const cursorReq = transaction.objectStore(store).index(index).openCursor(value);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  /**
   * Run `fn` inside a transaction on `store` and resolve when the transaction
   * COMMITS (not merely when the request succeeds), so writes are durable.
   */
  async tx<R>(
    store: string,
    mode: IDBTransactionMode,
    fn: (os: IDBObjectStore) => IDBRequest<R> | void,
  ): Promise<R | undefined> {
    const db = await this.open();
    return new Promise<R | undefined>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const os = transaction.objectStore(store);
      let result: R | undefined;
      const req = fn(os);
      if (req) {
        req.onsuccess = () => {
          result = req.result;
        };
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

/** A typed handle to one object store. `T` must contain the store's keyPath field. */
export class Collection<T> {
  constructor(
    private readonly db: Database,
    private readonly store: string,
  ) {}

  get(id: IDBValidKey): Promise<T | undefined> {
    return this.db.tx<T>(this.store, "readonly", (os) => os.get(id) as IDBRequest<T>);
  }

  put(value: T): Promise<void> {
    return this.db.tx(this.store, "readwrite", (os) => os.put(value)).then(() => undefined);
  }

  delete(id: IDBValidKey): Promise<void> {
    return this.db.tx(this.store, "readwrite", (os) => os.delete(id)).then(() => undefined);
  }

  getAll(): Promise<T[]> {
    return this.db.tx<T[]>(this.store, "readonly", (os) => os.getAll()).then((r) => r ?? []);
  }

  getAllByIndex(index: string, value: IDBValidKey): Promise<T[]> {
    return this.db
      .tx<T[]>(this.store, "readonly", (os) => os.index(index).getAll(value))
      .then((r) => r ?? []);
  }

  deleteByIndex(index: string, value: IDBValidKey): Promise<void> {
    return this.db.deleteByIndex(this.store, index, value);
  }

  count(): Promise<number> {
    return this.db.tx<number>(this.store, "readonly", (os) => os.count()).then((r) => r ?? 0);
  }

  clear(): Promise<void> {
    return this.db.tx(this.store, "readwrite", (os) => os.clear()).then(() => undefined);
  }
}
