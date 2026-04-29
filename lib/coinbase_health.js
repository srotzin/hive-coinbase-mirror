/**
 * coinbase_health.js — Background pinger for target x402 facilitator.
 * Pings every 60 s; keeps a rolling 24 h window of results.
 * Hive Civilization — hive-coinbase-mirror
 */

import { fetch as undiciFetch } from 'undici';

const PING_INTERVAL_MS = 60_000;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export class CoinbaseHealthMonitor {
  /**
   * @param {string} targetUrl   Base URL of the target facilitator
   * @param {object} circuit     CircuitBreaker instance (shared)
   */
  constructor(targetUrl, circuit) {
    this.targetUrl = targetUrl;
    this.circuit = circuit;
    this._history = []; // [{ts, ok, latency_ms, status}]
    this._timer = null;
    this._last = null;
  }

  start() {
    this._ping();
    this._timer = setInterval(() => this._ping(), PING_INTERVAL_MS);
    if (this._timer.unref) this._timer.unref(); // don't block process exit
    console.log(`[health] pinger started → ${this.targetUrl} every ${PING_INTERVAL_MS / 1000}s`);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  async _ping() {
    const t0 = Date.now();
    let ok = false;
    let latency_ms = null;
    let status = null;
    try {
      const res = await undiciFetch(this.targetUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(8_000),
      });
      latency_ms = Date.now() - t0;
      status = res.status;
      ok = status < 500;
      if (ok) this.circuit.onSuccess();
      else this.circuit.onFailure();
    } catch (err) {
      latency_ms = Date.now() - t0;
      status = 0;
      ok = false;
      this.circuit.onFailure();
      console.warn(`[health] ping error: ${err.message}`);
    }
    const entry = { ts: Date.now(), ok, latency_ms, status };
    this._history.push(entry);
    this._last = entry;
    // Prune to window
    const cutoff = Date.now() - WINDOW_MS;
    this._history = this._history.filter(e => e.ts >= cutoff);
  }

  /** Returns last known health snapshot for GET /v1/cb-mirror/health-coinbase */
  snapshot() {
    return {
      ok: this._last ? this._last.ok : null,
      latency_ms: this._last ? this._last.latency_ms : null,
      last_status: this._last ? this._last.status : null,
      last_checked: this._last ? new Date(this._last.ts).toISOString() : null,
      target_url: this.targetUrl,
    };
  }

  /** Returns 24 h uptime stats for GET /v1/cb-mirror/uptime */
  uptimeStats(totalRequests, passthroughCount, fallbackCount) {
    const now = Date.now();
    const windowStart = new Date(now - WINDOW_MS).toISOString();
    const windowEnd = new Date(now).toISOString();
    const pings = this._history.length;
    const okPings = this._history.filter(e => e.ok).length;
    const observedUptime = pings > 0 ? ((okPings / pings) * 100).toFixed(3) : 'N/A';
    const fallbackPct = totalRequests > 0
      ? ((fallbackCount / totalRequests) * 100).toFixed(3)
      : '0.000';

    return {
      target_facilitator: this.targetUrl,
      total_requests: totalRequests,
      passthrough_count: passthroughCount,
      fallback_count: fallbackCount,
      fallback_pct: `${fallbackPct}%`,
      observed_uptime_pct: `${observedUptime}%`,
      ping_samples_24h: pings,
      window_start: windowStart,
      window_end: windowEnd,
    };
  }
}
