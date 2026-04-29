# v1.0.0 — hive-coinbase-mirror MCP Server

**Operator:** Hive Civilization  
**Brand gold:** #C08D23  
**Date:** 2025-01-01  
**Status:** Phase 1 — proxy + fallback ledger

---

## What ships

Third-party uptime-arbitrage mirror of the Coinbase x402 facilitator (`x402.org/facilitator`). Proxies settlements; falls back to internal ledger on 5xx/429. 2 bps insurance fee on every mirrored settlement notional.

**NOT affiliated with Coinbase, Inc.** This is an independent mirror operated by Hive Civilization.

---

## Tools

| Tool | Description |
|---|---|
| `mirror_settle` | Proxy x402 payload → target facilitator. Auto-fallback on 5xx/429. |
| `mirror_status` | Retrieve past settlement event by `request_id`. |
| `mirror_uptime` | 24 h uptime stats: passthrough %, fallback %, observed uptime %. |

---

## Backend endpoint

`https://hive-coinbase-mirror.onrender.com`

- `POST /v1/cb-mirror/settle`
- `GET /v1/cb-mirror/status/:request_id`
- `GET /v1/cb-mirror/uptime`
- `GET /v1/cb-mirror/health-coinbase`
- `GET /.well-known/agent.json`
- `GET /mcp`

---

## Settlement rails

| Currency | Chain | Address |
|---|---|---|
| USDC | Base (8453) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDT | Base (8453) | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` |

**Monroe:** `0x15184bf50b3d3f52b60434f8942b7d52f2eb436e` (Base 8453)

---

## Fee mechanics

- 2 bps on settlement notional
- Floor: $0.001 per request
- Cap: $5.00 per request
- Phase 1: fee logged offline. On-chain skim is Phase 2.

---

## Phase disclosure

**Phase 1 (this release):** This service does NOT hold keys or sign payments. It only proxies x402 messages. Fallback = ledger entry. No on-chain settlement executed on behalf of any client.

**Phase 2 (planned):** On-chain fallback execution with explicit client wallet authorization + on-chain fee skim.

---

## Council provenance

Ad-hoc surface ship. Real rails: Base USDC + Base USDT mainnet.

---

*Hive Civilization — #C08D23*
