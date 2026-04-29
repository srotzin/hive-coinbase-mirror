/**
 * circuit.js — Simple circuit breaker for upstream facilitator calls.
 * Opens after 5 failures in 60 s window; stays open for 60 s.
 * Hive Civilization — hive-coinbase-mirror
 */

export class CircuitBreaker {
  /**
   * @param {object} opts
   * @param {number} opts.failureThreshold  failures before open (default 5)
   * @param {number} opts.windowMs          rolling window in ms (default 60_000)
   * @param {number} opts.openDurationMs    how long to stay open in ms (default 60_000)
   */
  constructor({ failureThreshold = 5, windowMs = 60_000, openDurationMs = 60_000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.windowMs = windowMs;
    this.openDurationMs = openDurationMs;

    this._state = 'closed'; // 'closed' | 'open' | 'half-open'
    this._failures = [];    // timestamps of recent failures
    this._openedAt = null;
  }

  get state() {
    if (this._state === 'open') {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed >= this.openDurationMs) {
        this._state = 'half-open';
      }
    }
    return this._state;
  }

  /** Returns true if the caller should attempt the upstream request. */
  allowRequest() {
    return this.state !== 'open';
  }

  /** Call after a successful upstream response. */
  onSuccess() {
    this._failures = [];
    this._state = 'closed';
    this._openedAt = null;
  }

  /** Call after a failure (5xx / timeout / network error). */
  onFailure() {
    const now = Date.now();
    // Prune failures outside the window
    this._failures = this._failures.filter(t => now - t < this.windowMs);
    this._failures.push(now);

    if (this._failures.length >= this.failureThreshold) {
      if (this._state !== 'open') {
        this._state = 'open';
        this._openedAt = now;
        console.warn(`[circuit] OPEN — ${this._failures.length} failures in ${this.windowMs / 1000}s window`);
      }
    }
  }

  toJSON() {
    return {
      state: this.state,
      failures_in_window: this._failures.length,
      opened_at: this._openedAt ? new Date(this._openedAt).toISOString() : null,
    };
  }
}
