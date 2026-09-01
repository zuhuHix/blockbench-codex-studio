import type { BlockbenchSnapshot } from "@blockbench-codex/contracts";

export class SnapshotStore {
  readonly #staleAfterMilliseconds: number;
  #snapshot: BlockbenchSnapshot | undefined;
  #receivedAt: number | undefined;

  constructor(staleAfterMilliseconds = 5_000) {
    this.#staleAfterMilliseconds = staleAfterMilliseconds;
  }

  set(snapshot: BlockbenchSnapshot, receivedAt = Date.now()): void {
    this.#snapshot = snapshot;
    this.#receivedAt = receivedAt;
  }

  get(): BlockbenchSnapshot | undefined {
    return this.#snapshot;
  }

  status(now = Date.now()): {
    connected: boolean;
    stale: boolean;
    lastSnapshotAt?: string;
  } {
    if (this.#receivedAt === undefined) {
      return { connected: false, stale: false };
    }

    const stale = now - this.#receivedAt > this.#staleAfterMilliseconds;
    return {
      connected: !stale,
      stale,
      lastSnapshotAt: new Date(this.#receivedAt).toISOString(),
    };
  }
}
