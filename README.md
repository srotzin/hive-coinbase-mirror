# hive-coinbase-mirror

<p>
  <img src="https://img.shields.io/badge/operator-Hive%20Civilization-C08D23?style=flat-square&labelColor=1a1a1a" />
  <img src="https://img.shields.io/badge/independent-true-C08D23?style=flat-square&labelColor=1a1a1a" />
  <img src="https://img.shields.io/badge/mirrors-x402.org%2Fcoinbase--facilitator-C08D23?style=flat-square&labelColor=1a1a1a" />
  <img src="https://img.shields.io/badge/fee-2%20bps-C08D23?style=flat-square&labelColor=1a1a1a" />
  <img src="https://img.shields.io/badge/chain-Base%208453-C08D23?style=flat-square&labelColor=1a1a1a" />
  <img src="https://img.shields.io/badge/phase-1%20%E2%80%94%20proxy%20%2B%20ledger-555?style=flat-square" />
</p>

> **TRADEMARK DISCLAIMER** — This service is **NOT** affiliated with, endorsed by, or associated with **Coinbase, Inc.** in any way. The word "Coinbase" appears solely as a descriptor of the third-party upstream facilitator (`x402.org/facilitator`) that this mirror proxies. All intellectual property associated with Coinbase belongs to Coinbase, Inc. Hive Civilization operates this mirror independently under MIT license.

---

## What is this?

**hive-coinbase-mirror** is a third-party **uptime-arbitrage** mirror of the [x402.org](https://x402.org) Coinbase facilitator. It sits in front of the Coinbase x402 facilitator endpoint and provides:

| Guarantee | Mechanism |
|---|---|
| **Continuity** | If `x402.org/facilitator` returns 5xx or 429, traffic falls back to Hive's internal settlement ledger |
| **Circuit breaker** | 5 failures in 60 s → circuit opens for 60 s; all requests go to fallback immediately |
| **Uptime telemetry** | 24 h rolling stats: passthrough vs fallback counts, observed uptime % |
| **Insurance fee** | 2 bps on settlement notional. Floor $0.001, cap $5.00 |

---

## Uptime Arbitrage Thesis

The Coinbase x402 facilitator is a public good. But public goods have downtime. Every minute the upstream is unavailable, agents lose settlement continuity. **2 bps** is the insurance premium for guaranteed fallback ledger coverage — sub-penny for most transactions, automatic, no configuration required.

---

## Phase 1 / Phase 2 Disclosure

**Phase 1 (current — this release):**
- This service **does NOT hold private keys** and **does NOT sign any on-chain transactions** on behalf of clients.
- When the upstream facilitator is unavailable, this service logs the failed settlement to a JSONL file (`/tmp/cb_mirror_settlements.jsonl`) and returns a `X-Hive-Mirror: fallback` response.
- The 2 bps fee is **calculated and logged offline**. No on-chain fee skim occurs in Phase 1.
- **No on-chain settlement is executed on your behalf.** The fallback ledger is a record, not an execution.

**Phase 2 (planned):**
- Clients explicitly authorize a Hive wallet to execute fallback settlements on-chain.
- Fee skim executes on-chain against Monroe (`0x15184bf50b3d3f52b60434f8942b7d52f2eb436e` on Base 8453).

---

## Tools

| Tool | Description |
|---|---|
| `mirror_settle` | Proxy an x402 payment payload to target facilitator. Auto-fallback on 5xx/429. Fee logged. |
| `mirror_status` | Retrieve a past settlement event by `request_id`. |
| `mirror_uptime` | Bloomberg-style 24 h uptime stats: passthrough %, fallback %, observed uptime %. |

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Service metadata |
| `GET` | `/health` | Health check + circuit breaker state |
| `GET` | `/.well-known/agent.json` | A2A agent card (operator, mirrors, Monroe, fee) |
| `GET` | `/mcp` | MCP JSON-RPC tools/list |
| `POST` | `/mcp` | MCP JSON-RPC tool execution |
| `POST` | `/v1/cb-mirror/settle` | **Primary:** settle via mirror |
| `GET` | `/v1/cb-mirror/status/:request_id` | Settlement event lookup |
| `GET` | `/v1/cb-mirror/uptime` | 24 h uptime stats |
| `GET` | `/v1/cb-mirror/health-coinbase` | Latest upstream health ping |

---

## POST /v1/cb-mirror/settle

**Request body:**

```json
{
  "x402_payload": {
    "amount": 10.00,
    "currency": "USDC",
    "recipient": "0xYourAddress"
  },
  "target_facilitator_url": "https://x402.org/facilitator"
}
```

**Response (passthrough success):**

```json
{
  "ok": true,
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "mode": "passthrough",
  "upstream_status": 200,
  "notional_usd": 10.00,
  "fee_atomic_usd": 0.002,
  "fee_bps": 2,
  "fee_note": "Phase 1: fee logged offline. On-chain skim is Phase 2.",
  "circuit": { "state": "closed", "failures_in_window": 0, "opened_at": null },
  "ts": "2025-01-01T00:00:00.000Z",
  "disclaimer": "This service does NOT hold keys or sign payments..."
}
```

**Response headers:**

| Header | Value |
|---|---|
| `X-Hive-Mirror` | `passthrough` or `fallback` |
| `X-Hive-Mirror-Reason` | Upstream HTTP status (e.g. `503`) or `circuit_open` |
| `X-Hive-Request-Id` | UUID for event lookup |

---

## Fee Mechanics

```
fee = notional_usd × 2 / 10,000
fee = max(fee, $0.001)
fee = min(fee, $5.00)
```

| Notional | Fee |
|---|---|
| $0.10 | $0.001 (floor) |
| $10.00 | $0.002 |
| $1,000.00 | $0.20 |
| $250,000.00 | $5.00 (cap) |

Phase 1: fee calculated from `x402_payload.amount` (or `.value`, `.notional`, `.settlement.amount`). Logged to JSONL. Reconciled offline.

---

## Settlement Currency

| Currency | Chain | Address |
|---|---|---|
| USDC | Base (8453) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDT | Base (8453) | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` |

**Monroe wallet:** `0x15184bf50b3d3f52b60434f8942b7d52f2eb436e` (Base 8453)

---

## Circuit Breaker

- **Threshold:** 5 failures within a 60 s rolling window
- **Open duration:** 60 s
- **Half-open:** After 60 s, circuit allows one probe request
- When open: all settle requests go immediately to fallback ledger

State visible in `GET /health` response.

---

## Connect

### MCP (Claude, Cursor, etc.)

Add to your MCP config:

```json
{
  "mcpServers": {
    "hive-coinbase-mirror": {
      "url": "https://hive-coinbase-mirror.onrender.com/mcp",
      "transport": "http"
    }
  }
}
```

### Smithery

[https://smithery.ai/server/srotzin/hive-coinbase-mirror](https://smithery.ai/server/srotzin/hive-coinbase-mirror)

### A2A Agent Card

```
GET https://hive-coinbase-mirror.onrender.com/.well-known/agent.json
```

---

## Run locally

```bash
git clone https://github.com/srotzin/hive-coinbase-mirror
cd hive-coinbase-mirror
npm install
node server.js
```

Optional env vars:

```
TARGET_FACILITATOR_URL=https://x402.org/facilitator
SETTLEMENTS_LOG=/tmp/cb_mirror_settlements.jsonl
PORT=3000
```

---

## Ecosystem

| Repo | Role |
|---|---|
| [hive-mcp-exchange](https://github.com/srotzin/hive-mcp-exchange) | On-chain exchange primitives |
| [hive-mcp-swap](https://github.com/srotzin/hive-mcp-swap) | Token swap routing |
| [hive-mcp-vault](https://github.com/srotzin/hive-mcp-vault) | Yield vault interface |
| [hive-mcp-evaluator](https://github.com/srotzin/hive-mcp-evaluator) | Settlement evaluation |
| [hive-mcp-trade](https://github.com/srotzin/hive-mcp-trade) | Trade execution |
| [hive-coinbase-mirror](https://github.com/srotzin/hive-coinbase-mirror) | **This repo** — x402 mirror |

---

## License

MIT © 2025 Hive Civilization

> Brand gold: **#C08D23** (Pantone 1245 C) — Hive Civilization standard.
