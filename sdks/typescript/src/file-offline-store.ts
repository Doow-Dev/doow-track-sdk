/**
 * S80: FileOfflineStore — built-in persistent store for failed batches.
 *
 * Writes each failed batch as a separate JSON file in a configurable directory.
 * Uses atomic write (write to temp file, rename) to prevent corrupt reads.
 * Implements FIFO ordering via filename sort (filenames include ISO timestamp prefix).
 *
 * Usage:
 *   const store = new FileOfflineStore('./doow-track-offline');
 *   const meter = new DoowTracker('dk_...', { offlineStore: store });
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import type { OfflineStore, SerializedBatch } from './types.js';

export class FileOfflineStore implements OfflineStore {
  private readonly _dir: string;

  constructor(dir = './doow-track-offline') {
    this._dir = dir;
  }

  /** Ensure the storage directory exists */
  private async _ensureDir(): Promise<void> {
    await fs.mkdir(this._dir, { recursive: true });
  }

  /** All batch files, sorted by name (ascending = oldest first) */
  private async _listFiles(): Promise<string[]> {
    await this._ensureDir();
    const entries = await fs.readdir(this._dir);
    return entries
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp.json'))
      .sort() // lexicographic sort: timestamp prefix ensures FIFO
      .map((f) => join(this._dir, f));
  }

  /**
   * Persist a batch.
   * Filename: {ISO_timestamp}_{batch_id}.json — sortable, unique.
   * Atomic: write to .tmp.json then rename.
   */
  async push(batch: SerializedBatch): Promise<void> {
    await this._ensureDir();
    // Use the batch timestamp for sortable filename; fall back to now
    const ts = batch.timestamp.replace(/[:.]/g, '-');
    const filename = `${ts}_${batch.batch_id}.json`;
    const filePath = join(this._dir, filename);
    const tmpPath = join(this._dir, `${filename}.tmp`);

    const content = JSON.stringify(batch);
    // Atomic: write to tmp, then rename into place
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  /**
   * Retrieve and remove the oldest batch (FIFO).
   * Returns undefined if store is empty.
   */
  async shift(): Promise<SerializedBatch | undefined> {
    const files = await this._listFiles();
    if (files.length === 0) return undefined;

    const oldest = files[0]!;
    let content: string;
    try {
      content = await fs.readFile(oldest, 'utf8');
    } catch {
      // File may have been removed concurrently — treat as empty
      return undefined;
    }

    let batch: SerializedBatch;
    try {
      batch = JSON.parse(content) as SerializedBatch;
    } catch {
      try {
        await fs.unlink(oldest);
      } catch {
        /* best effort */
      }
      return undefined;
    }

    try {
      await fs.unlink(oldest);
    } catch {
      // Best effort — if delete fails, we may replay; acceptable for offline store
    }

    return batch;
  }

  /** Number of pending batches in the store */
  async length(): Promise<number> {
    const files = await this._listFiles();
    return files.length;
  }

  /** Directory this store writes to */
  get directory(): string {
    return this._dir;
  }
}
