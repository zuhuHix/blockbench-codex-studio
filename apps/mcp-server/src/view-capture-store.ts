import type { MultiViewCapture } from "@blockbench-codex/contracts";

interface Waiter {
  readonly resolve: (capture: MultiViewCapture) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Correlates a queued capture_views command with the multi-view capture the
 * Blockbench plugin posts back, so an MCP tool call can await one round trip.
 */
export class ViewCaptureStore {
  readonly #waiters = new Map<string, Waiter>();
  readonly #delivered = new Map<string, MultiViewCapture>();
  readonly #latest = new Map<string, MultiViewCapture>();

  /** Resolves when the plugin posts the capture, or rejects on timeout. */
  wait(
    requestId: string,
    timeoutMilliseconds = 20_000,
  ): Promise<MultiViewCapture> {
    const alreadyDelivered = this.#delivered.get(requestId);
    if (alreadyDelivered !== undefined) {
      this.#delivered.delete(requestId);
      return Promise.resolve(alreadyDelivered);
    }
    if (this.#waiters.has(requestId))
      return Promise.reject(
        new Error("That capture request is already being awaited."),
      );
    return new Promise<MultiViewCapture>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(requestId);
        reject(
          new Error(
            "Blockbench did not return the requested views in time. Is the plugin connected?",
          ),
        );
      }, timeoutMilliseconds);
      timer.unref?.();
      this.#waiters.set(requestId, { resolve, reject, timer });
    });
  }

  /** Called when the plugin posts a completed multi-view capture. */
  complete(capture: MultiViewCapture): void {
    this.#latest.set(capture.projectId, capture);
    const waiter = this.#waiters.get(capture.requestId);
    if (waiter === undefined) {
      this.#delivered.set(capture.requestId, capture);
      return;
    }
    this.#waiters.delete(capture.requestId);
    clearTimeout(waiter.timer);
    waiter.resolve(capture);
  }

  /** Called when the plugin acknowledges the command as failed. */
  fail(requestId: string, message: string): void {
    const waiter = this.#waiters.get(requestId);
    if (waiter === undefined) return;
    this.#waiters.delete(requestId);
    clearTimeout(waiter.timer);
    waiter.reject(new Error(message));
  }

  /** The most recent capture for a project, for panels that poll. */
  latest(projectId: string): MultiViewCapture | undefined {
    return this.#latest.get(projectId);
  }
}
