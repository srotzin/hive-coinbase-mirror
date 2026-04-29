/**
 * hive-coinbase-mirror — server.js
 * Third-party uptime-arbitrage mirror of x402 facilitators.
 * Operated by Hive Civilization. NOT affiliated with, endorsed by,
 * or associated with Coinbase, Inc. in any way.
 *
 * Phase 1: proxy + fallback ledger. No on-chain signing.
 * Phase 2 (future): on-chain fallback execution with explicit client wallet auth.
 *
 * Settlement currency: Base USDC / Base USDT (mainnet)
 * Monroe wallet: 0x15184bf50b3d3f52b60434f8942b7d52f2eb436e (chain 8453)
 * Insurance fee: 2 bps on notional. Floor $0.001. Cap $5.00. Logged offline (Phase 1).
 *
 * Brand gold: #C08D23
 */

import express from 'express';
import { fetch as undiciFetch } from 'undici';
import { createWriteStream, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { CircuitBreaker } from './lib/circuit.js';
import { CoinbaseHealthMonitor } from './lib/coinbase_health.js';

const PORT = process.env.PORT || 3000;
const DEFAULT_TARGET = process.env.TARGET_FACILITATOR_URL || 'https://x402.org/facilitator';
const SETTLEMENTS_LOG = process.env.SETTLEMENTS_LOG || '/tmp/cb_mirror_settlements.jsonl';
const MONROE = '0x15184bf50b3d3f52b60434f8942b7d52f2eb436e';
const CHAIN_ID = 8453;
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDT_ADDRESS = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2';
const FEE_BPS = 2;
const FEE_FLOOR_USD = 0.001;
const FEE_CAP_USD = 5.00;

// ─── State ────────────────────────────────────────────────────────────────────
const circuit = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000, openDurationMs: 60_000 });
const healthMonitor = new CoinbaseHealthMonitor(DEFAULT_TARGET, circuit);

let totalRequests = 0;
let passthroughCount = 0;
let fallbackCount = 0;

// In-memory request index (request_id → event summary). Capped at 10 k entries.
const requestIndex = new Map();
const MAX_INDEX = 10_000;

// JSONL log stream
const logStream = createWriteStream(SETTLEMENTS_LOG, { flags: 'a' });

function appendSettlement(entry) {
  logStream.write(JSON.stringify(entry) + '\n');
}

// ─── Fee calculation ──────────────────────────────────────────────────────────
/**
 * Extract notional (USD float) from a decoded x402 payment payload.
 * x402 payloads vary; we attempt several known field names.
 * Returns null if we cannot determine notional.
 */
function extractNotional(x402Payload) {
  if (!x402Payload || typeof x402Payload !== 'object') return null;
  // Common field paths in x402 payment objects
  const candidates = [
    x402Payload?.amount,
    x402Payload?.value,
    x402Payload?.notional,
    x402Payload?.settlement?.amount,
    x402Payload?.payment?.amount,
  ];
  for (const c of candidates) {
    const n = parseFloat(c);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function calcFeeAtomic(notionalUsd) {
  if (notionalUsd === null) return null;
  let fee = notionalUsd * FEE_BPS / 10_000;
  fee = Math.max(fee, FEE_FLOOR_USD);
  fee = Math.min(fee, FEE_CAP_USD);
  return parseFloat(fee.toFixed(6)); // USD
}

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: 'application/x-www-form-urlencoded', limit: '1mb' }));

// ─── GET / ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'hive-coinbase-mirror',
    operator: 'Hive Civilization',
    description: 'Third-party uptime-arbitrage mirror of x402 facilitators. ' +
      'NOT affiliated with Coinbase, Inc. Falls back to internal ledger on 5xx/429. ' +
      '2 bps insurance fee on settled notional.',
    version: '1.0.0',
    phase: 'Phase 1 — proxy + fallback ledger. No on-chain signing by this service.',
    docs: 'https://github.com/srotzin/hive-coinbase-mirror',
    brand_gold: '#C08D23',
    default_target: DEFAULT_TARGET,
    monroe: MONROE,
    chain_id: CHAIN_ID,
  });
});

// ─── GET /health ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'hive-coinbase-mirror',
    ts: new Date().toISOString(),
    circuit: circuit.toJSON(),
    uptime_s: Math.floor(process.uptime()),
  });
});

// ─── GET /.well-known/agent.json ──────────────────────────────────────────────
app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: 'hive-coinbase-mirror',
    version: '1.0.0',
    description: 'Third-party uptime-arbitrage mirror of the Coinbase x402 facilitator. ' +
      'Proxies settlements to x402.org/facilitator; falls back to Hive ledger on 5xx/429. ' +
      '2 bps insurance fee on every mirrored settlement notional. Phase 1: no on-chain signing.',
    operator: 'Hive Civilization',
    operator_url: 'https://github.com/srotzin',
    independent: true,
    mirrors: 'x402.org/coinbase-facilitator',
    disclaimer: 'This service is NOT affiliated with, endorsed by, or associated with Coinbase, Inc. ' +
      '"Coinbase" is used solely as a descriptor of the upstream service being mirrored. ' +
      'Hive Civilization operates this mirror independently.',
    phase: 'Phase 1 — proxy + fallback ledger. On-chain fallback execution is Phase 2.',
    monroe: {
      address: MONROE,
      chain_id: CHAIN_ID,
      chain: 'Base',
      usdc: USDC_ADDRESS,
      usdt: USDT_ADDRESS,
    },
    fee: {
      bps: FEE_BPS,
      description: '2 bps insurance fee on settlement notional. Floor $0.001, cap $5.00.',
      phase: 'Phase 1: fee is logged and reconciled offline. On-chain skim is Phase 2.',
    },
    x402: {
      payment_recipients: [MONROE],
      chains: [CHAIN_ID],
      currencies: ['USDC', 'USDT'],
    },
    endpoints: {
      settle: 'POST /v1/cb-mirror/settle',
      status: 'GET /v1/cb-mirror/status/:request_id',
      uptime: 'GET /v1/cb-mirror/uptime',
      health_coinbase: 'GET /v1/cb-mirror/health-coinbase',
      mcp: 'GET /mcp',
    },
    llm_endpoint: 'https://hivecompute-g2g7.onrender.com/v1/compute/chat/completions',
    brand_gold: '#C08D23',
  });
});

// ─── GET /mcp (JSON-RPC 2.0 tools/list) ──────────────────────────────────────
app.get('/mcp', (req, res) => {
  res.json({
    jsonrpc: '2.0',
    id: null,
    result: {
      tools: [
        {
          name: 'mirror_settle',
          description: 'Proxy an x402 settlement through the Coinbase facilitator with automatic fallback. ' +
            '2 bps insurance fee logged. Phase 1: no on-chain signing by this service.',
          inputSchema: {
            type: 'object',
            properties: {
              x402_payload: { type: 'object', description: 'Decoded x402 payment payload' },
              target_facilitator_url: {
                type: 'string',
                description: 'Target facilitator URL (default: https://x402.org/facilitator)',
                default: DEFAULT_TARGET,
              },
            },
            required: ['x402_payload'],
          },
        },
        {
          name: 'mirror_status',
          description: 'Check the status of a past mirror settlement event by request_id.',
          inputSchema: {
            type: 'object',
            properties: {
              request_id: { type: 'string', description: 'UUID returned from mirror_settle' },
            },
            required: ['request_id'],
          },
        },
        {
          name: 'mirror_uptime',
          description: 'Bloomberg-style 24 h uptime stats for the target facilitator and this mirror.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    },
  });
});

app.post('/mcp', express.json(), async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};
  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC' } });
  }

  if (method === 'tools/list') {
    const tools = [
      {
        name: 'mirror_settle',
        description: 'Proxy an x402 settlement through the Coinbase facilitator with automatic fallback.',
        inputSchema: { type: 'object', properties: { x402_payload: { type: 'object' }, target_facilitator_url: { type: 'string' } }, required: ['x402_payload'] },
      },
      {
        name: 'mirror_status',
        description: 'Check past mirror settlement status by request_id.',
        inputSchema: { type: 'object', properties: { request_id: { type: 'string' } }, required: ['request_id'] },
      },
      {
        name: 'mirror_uptime',
        description: '24 h uptime stats.',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
    return res.json({ jsonrpc: '2.0', id, result: { tools } });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    if (toolName === 'mirror_settle') {
      const { x402_payload, target_facilitator_url } = toolArgs;
      if (!x402_payload) {
        return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'x402_payload required' } });
      }
      const result = await doSettle(x402_payload, target_facilitator_url || DEFAULT_TARGET, req.headers);
      return res.json({ jsonrpc: '2.0', id, result });
    }

    if (toolName === 'mirror_status') {
      const event = requestIndex.get(toolArgs.request_id);
      if (!event) return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'request_id not found' } });
      return res.json({ jsonrpc: '2.0', id, result: event });
    }

    if (toolName === 'mirror_uptime') {
      return res.json({ jsonrpc: '2.0', id, result: healthMonitor.uptimeStats(totalRequests, passthroughCount, fallbackCount) });
    }

    return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } });
  }

  return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
});

// ─── Core settle logic ────────────────────────────────────────────────────────
async function doSettle(x402Payload, targetUrl, incomingHeaders) {
  const requestId = randomUUID();
  const ts = Date.now();
  totalRequests++;

  const notionalUsd = extractNotional(x402Payload);
  const feeAtomic = calcFeeAtomic(notionalUsd);

  let mode = 'passthrough';
  let upstreamStatus = null;
  let upstreamBody = null;
  let error = null;

  const circuitOpen = !circuit.allowRequest();

  if (!circuitOpen) {
    try {
      const upRes = await undiciFetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'hive-coinbase-mirror/1.0.0 (Hive Civilization; third-party)',
        },
        body: JSON.stringify(x402Payload),
        signal: AbortSignal.timeout(10_000),
      });
      upstreamStatus = upRes.status;

      // Read body once
      const rawText = await upRes.text().catch(() => '');
      try { upstreamBody = rawText ? JSON.parse(rawText) : {}; } catch { upstreamBody = { raw: rawText }; }

      if (upstreamStatus === 429 || upstreamStatus >= 500) {
        // Trigger fallback
        circuit.onFailure();
        fallbackCount++;
        mode = 'fallback';
      } else {
        // 2xx or 4xx (non-retry) — pass through
        circuit.onSuccess();
        passthroughCount++;
        mode = upstreamStatus >= 200 && upstreamStatus < 300 ? 'passthrough' : 'passthrough_error';
      }
    } catch (err) {
      // Network / timeout
      circuit.onFailure();
      fallbackCount++;
      mode = 'fallback';
      error = err.message;
    }
  } else {
    // Circuit open — go straight to fallback
    fallbackCount++;
    mode = 'fallback';
    upstreamStatus = 'circuit_open';
  }

  const entry = {
    request_id: requestId,
    ts: new Date(ts).toISOString(),
    mode,
    target_url: targetUrl,
    upstream_status: upstreamStatus,
    notional_usd: notionalUsd,
    fee_atomic_usd: feeAtomic,
    fee_bps: FEE_BPS,
    circuit: circuit.toJSON(),
    error: error || undefined,
  };

  appendSettlement(entry);

  // Update in-memory index
  if (requestIndex.size >= MAX_INDEX) {
    const oldest = requestIndex.keys().next().value;
    requestIndex.delete(oldest);
  }
  requestIndex.set(requestId, entry);

  return entry;
}

// ─── POST /v1/cb-mirror/settle ────────────────────────────────────────────────
app.post('/v1/cb-mirror/settle', async (req, res) => {
  const { x402_payload, target_facilitator_url } = req.body || {};

  if (!x402_payload) {
    return res.status(400).json({
      error: 'x402_payload is required',
      example: { x402_payload: { amount: 10.00 }, target_facilitator_url: DEFAULT_TARGET },
    });
  }

  const target = target_facilitator_url || DEFAULT_TARGET;
  const entry = await doSettle(x402_payload, target, req.headers);

  const status = entry.mode === 'passthrough' ? 200 : entry.mode === 'fallback' ? 200 : 200;

  const mirrorHeader = entry.mode.startsWith('passthrough') ? 'passthrough' : 'fallback';

  res
    .status(status)
    .set('X-Hive-Mirror', mirrorHeader)
    .set('X-Hive-Mirror-Reason', String(entry.upstream_status || 'N/A'))
    .set('X-Hive-Request-Id', entry.request_id)
    .json({
      ok: true,
      request_id: entry.request_id,
      mode: entry.mode,
      upstream_status: entry.upstream_status,
      notional_usd: entry.notional_usd,
      fee_atomic_usd: entry.fee_atomic_usd,
      fee_bps: FEE_BPS,
      fee_note: 'Phase 1: fee logged offline. On-chain skim is Phase 2.',
      circuit: entry.circuit,
      ts: entry.ts,
      disclaimer: 'This service does NOT hold keys or sign payments. It only proxies x402 messages. ' +
        'Fallback entries are ledgered offline; no on-chain settlement is executed on your behalf in Phase 1.',
    });
});

// ─── GET /v1/cb-mirror/status/:request_id ────────────────────────────────────
app.get('/v1/cb-mirror/status/:request_id', (req, res) => {
  const event = requestIndex.get(req.params.request_id);
  if (!event) {
    return res.status(404).json({
      error: 'request_id not found in memory index',
      note: 'Full history is available in the JSONL settlement log.',
    });
  }
  res.json(event);
});

// ─── GET /v1/cb-mirror/uptime ─────────────────────────────────────────────────
app.get('/v1/cb-mirror/uptime', (req, res) => {
  res.json(healthMonitor.uptimeStats(totalRequests, passthroughCount, fallbackCount));
});

// ─── GET /v1/cb-mirror/health-coinbase ───────────────────────────────────────
app.get('/v1/cb-mirror/health-coinbase', (req, res) => {
  res.json(healthMonitor.snapshot());
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[hive-coinbase-mirror] listening on :${PORT}`);
  console.log(`[hive-coinbase-mirror] target facilitator: ${DEFAULT_TARGET}`);
  console.log(`[hive-coinbase-mirror] settlements log: ${SETTLEMENTS_LOG}`);
  console.log(`[hive-coinbase-mirror] Monroe: ${MONROE} (chain ${CHAIN_ID})`);
  healthMonitor.start();
});
