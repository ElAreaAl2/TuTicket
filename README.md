# 🎟️ Secure Ticket — Fraud-Proof Event Ticketing on Stellar (Web2.5)

> **Buy a concert ticket with a normal card. Get a tamper-proof ticket secured on a public blockchain — without ever seeing a wallet, a seed phrase, or the word "crypto."**

Secure Ticket is a hybrid **Web2.5** ticketing platform that gives every ticket a verifiable on-chain identity on **Stellar / Soroban**, while keeping the buying experience as simple as any normal website. It attacks the three diseases of the live-events industry — **counterfeiting, double-spent QRs, and predatory scalping** — using smart contracts, signed QR tokens, and configurable resale rules.

---

## 🧠 The one-paragraph pitch

Traditional tickets are just images: easy to screenshot, forge, resell 10×, or sell twice. Fully on-chain ticketing fixes that but scares away 99% of users who don't own a wallet. **Secure Ticket is the middle ground:** a familiar web app on top, a Stellar smart contract per event underneath. Casual buyers pay with fiat and never touch the blockchain; power users can connect **Freighter** and self-custody, resell, and trade their tickets on-chain. Every ticket is a versioned record whose ownership and resale history live on a public ledger anyone can audit.

---

## 👀 Two ways to read this README

| If you are… | Read this |
| --- | --- |
| 🙋 **Non-technical** | The pitch above + [How it feels to a user](#-how-it-feels-to-a-user) + [What makes it special](#-what-makes-it-special) |
| 🧑‍💻 **Blockchain / backend expert** | [Architecture](#-architecture) + [On-chain ticket lifecycle](#-on-chain-ticket-lifecycle) + [Anchor integration](#-fiat-onofframp-via-stellar-anchor-sep-10--sep-24) |

---

## ✨ What makes it special

- **🛡️ Fraud-proof by design.** Each ticket is a *versioned* on-chain object. The QR is a **signed token** carrying the ticket id, its current version, and the expected owner — a screenshot of an old version is worthless after a resale.
- **💸 Real fiat payments, zero crypto friction.** Through a **Stellar Anchor (SEP-24)** the buyer pays with real money in the anchor's hosted window. The asset settles into a custodial account and tickets are issued automatically. The user never sees a blockchain.
- **🔁 Anti-scalping resale, enforced by code.** Resale isn't a policy in a PDF — it's enforced by the smart contract and backend: max price, max %, resale window, freeze before the event, and organizer fees. Cheating is rejected, not just frowned upon.
- **🦊 Optional self-custody with Freighter.** Want to truly own your ticket? Connect the **Freighter** wallet, sign with your own keys, and buy/list/transfer tickets peer-to-peer on Soroban. The backend never holds your private key.
- **🎨 Collectible NFTs.** Eligible tickets mint a collectible NFT (with proper `stellar.toml` metadata so wallets like Freighter/Lobstr show it as a *Collectible*), and burn/remint on verified resale so the collectible always tracks the real owner.

---

## 🙋 How it feels to a user

1. **Browse & buy** events like on any ticketing site. Add to cart, check out, pay with a card.
2. **Get your ticket** instantly with a signed QR — ready to scan at the door.
3. **(Optional) Secure it on-chain.** One click writes your ticket to the Stellar blockchain; if it's a collectible event, you also get an NFT.
4. **(Optional) Resell it safely.** List within the organizer's rules. The buyer pays, ownership moves on-chain, your old QR dies, theirs comes alive.
5. **Walk in.** Staff scans the QR; the system validates the signature + version and records the check-in, blocking any reuse.

The magic: steps 1–2 require **no wallet at all**. Steps 3–5 light up the blockchain for whoever wants it.

---

## 🏗️ Architecture

A **three-layer hybrid**:

```
┌──────────────────────────────────────────────────────────────┐
│  WEB2 LAYER  — React + Vite frontend                          │
│  Catalog · cart · checkout · admin · scanner · PQR · Freighter │
└───────────────┬──────────────────────────────────────────────┘
                │  REST
┌───────────────▼──────────────────────────────────────────────┐
│  BRIDGE  — Express + Prisma backend                           │
│  Business rules · builds Soroban XDR · signed QR tokens        │
│  Anchor SEP-10/24 client · on-chain event indexer              │
└───────┬───────────────────────────────────┬──────────────────┘
        │ PostgreSQL (Supabase)              │ Soroban RPC / Horizon
┌───────▼──────────┐              ┌──────────▼────────────────────┐
│  WEB2 STATE       │              │  WEB3 LAYER — Soroban (Rust)  │
│  events, orders,  │◄────indexer──┤  event_contract               │
│  tickets, PQR     │  projects    │  factory_contract             │
│                   │  on-chain    │  ticket_nft_contract          │
└───────────────────┘  events      └───────────────────────────────┘
```

- **`frontend/`** — React + Vite app. Talks REST to the backend, and `@stellar/freighter-api` directly to the user's wallet for signing.
- **`backend/`** — Express API + Prisma. Validates rules, **builds unsigned XDR** for the frontend to sign (it never custodies user keys), serves signed QR tokens, and runs an **indexer** that projects on-chain events back into PostgreSQL for fast reads.
- **`contracts/`** — Three Soroban smart contracts in Rust:
  - `event_contract` — ticket purchase, resale, redemption, versioning, events.
  - `factory_contract` — registers/deploys a contract per event.
  - `ticket_nft_contract` — the collectible NFT.

**Why "build XDR, sign on the client"?** In the Web2.5 model the backend constructs the exact Soroban transaction (`comprar_boleto`, `listar_boleto`, …) and returns the **unsigned XDR**. The frontend asks **Freighter** to sign it, then submits. The backend orchestrates the blockchain *without ever holding a user's private key.*

---

## ⛓️ On-chain ticket lifecycle

Every ticket is a **versioned record** in `event_contract`. Versioning is what makes fraud and stale-QR attacks impossible.

### 1. Secure (issue on-chain)
The organizer's custodial account issues the ticket on-chain to the buyer's linked wallet. Collectible events also mint an NFT in `ticket_nft_contract` (token id = ticket root id, so it survives resales).

### 2. Resale (anti-scalping, contract-enforced)
Before a ticket can be listed, the backend (`resalePolicy.ts`) **and** the contract validate:

- ✅ ownership & active state
- ✅ no duplicate listing
- ✅ **max price** and **max % over face value**
- ✅ **resale window** (start/end)
- ✅ **freeze before the event starts**
- ✅ organizer fees

On a confirmed resale the contract **bumps the version**: the previous version is cancelled, a new version is issued to the buyer. The old signed QR instantly stops validating; the new owner's QR comes alive. For collectibles, the NFT **burns and re-mints** to track the real owner.

> Contract entry points (Rust): `crear_boleto` / `crear_boleto_para`, `listar_boleto`, `cancelar_venta`, `comprar_boleto`, `redimir_boleto`, `invalidar_boleto`, plus read views like `obtener_version_vigente` and `obtener_boletos_reventa`.

### 3. Redemption at the door
The QR is a **signed token** (`qrPolicy.ts`) containing ticket id, version, and expected owner. The scanner validates the signature and version, records the check-in, and blocks reuse.

---

## 💳 Fiat on/off-ramp via Stellar Anchor (SEP-10 + SEP-24)

This is the bridge that lets a normal person pay **real money** and still get a blockchain-secured ticket — **without a wallet**.

**Flow** (`backend/src/anchor.ts` + `POST /api/checkout/confirm`):

1. **SEP-10 auth** — backend fetches a challenge, signs it with the custodial `ORGANIZER` keypair, exchanges it for a JWT.
2. **SEP-24 interactive deposit** — backend opens a hosted deposit; the buyer pays **fiat in the anchor's own window** (KYC/payment served by the anchor, not us).
3. **Settlement** — the asset lands in the custodial `ORGANIZER` account; the order stays `PENDING_PAYMENT`.
4. **Poll & emit** — the frontend polls `GET /api/checkout/anchor/:transactionId`; on `completed` the order is marked `PAID` and tickets are emitted (idempotent).

**Design notes for reviewers:**
- **Config-gated, no fallback.** If `ANCHOR_SEP10_URL` / `ANCHOR_SEP24_URL` are set, the anchor is the *only* payment path. If empty, checkout uses a **simulated payment** (for CI/local without an anchor).
- **One-time trustline.** The `ORGANIZER` account needs a trustline to the anchor asset, or deposits never reach `completed` (`scripts/add-anchor-trustline.ts`, idempotent).
- **Amount is intentionally omitted** from the deposit — the interactive window captures it (hardcoding it can exceed a test asset's per-tx limit).
- **General-admission only** goes through the anchor today; seated events use the simulated path (async seat-hold extension deferred).
- **Reference anchor (Testnet):** `testanchor.stellar.org` with asset `SRT`.

---

## 🦊 Freighter — the self-custody plug-in

[Freighter](https://freighter.app) is a Stellar browser wallet. In Secure Ticket it's the **opt-in power-user lane**:

- **Connect & link** (`ConnectWallet.tsx`) — request access, then prove ownership by signing a challenge (`walletChallengePolicy.ts`) that links the wallet to the user's account.
- **Sign, don't surrender** — for on-chain buy/list/cancel, the backend returns **unsigned XDR**; Freighter signs with the user's keys; the frontend submits. The private key never leaves the extension.
- **Live balance** — the UI shows the wallet's XLM balance (and a COP estimate) pulled from Horizon.

This is the crux of Web2.5: **custodial convenience for the masses, self-custody for those who want it — same app, same tickets.**

---

## 🚀 Quick start

```bash
# Backend  →  http://localhost:3000
cd backend
npm install
npm run prisma:generate
npm run dev

# Frontend  →  http://localhost:5173  (other terminal)
cd frontend
npm install
npm run dev

# Contracts
cd contracts
cargo test
```

You'll need (not versioned) `backend/.env` and `frontend/.env` — templates are in `*.env.example`. Real secrets (DB, JWT, organizer keypair, QR signing, anchor) are shared privately by the repo owner.

**Requirements:** Node.js ≥ 20.19, PostgreSQL, Rust + Soroban targets, Stellar/Soroban CLI, Freighter (Testnet) for manual Web3 tests, k6 for load tests.

### Live deployment (this fork)

| Layer | Hosting | URL |
| --- | --- | --- |
| Frontend | Vercel | https://tu-ticket-pi.vercel.app |
| Backend/API | Railway | https://tuticket-production.up.railway.app |
| Database | Supabase (PostgreSQL) | schema `ticketing` |
| Blockchain | Stellar Testnet / Soroban | — |

```bash
curl https://tuticket-production.up.railway.app/health     # {"status":"ok",...}
curl https://tuticket-production.up.railway.app/api/events  # event list
```

---

## ✅ Testing

```bash
cd backend  && npm run test:unit      # backend unit
cd backend  && npm run test:api       # backend API/integration
cd frontend && npm test               # frontend
cd frontend && npm run e2e            # E2E with controlled mocks
cd frontend && npm run e2e:real       # E2E against real backend + DB
cd contracts && cargo test            # Soroban contracts
BASE_URL=http://localhost:3000 ./load-tests/run-load-suite.sh   # k6 load
```

---

## ⚠️ Prototype scope (honest limitations)

This is an academic prototype, not a commercial product:

- Without an anchor configured, checkout uses **simulated payment**.
- Door validation is **DB-first**; on-chain redemption exists in the contract + indexer but doesn't block the operational scanner.
- Automated E2E tests don't sign with a real Freighter nor send end-to-end Soroban transactions.
- Testnet execution depends on funded accounts and public RPC availability.

---

## 📚 Documentation

- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/CONTRACTS_TECHNICAL_REFERENCE.md`
- `docs/operations/RUNTIME_DEPLOYMENT.md`
- `docs/operations/TESTING_LIMITATIONS.md`
- `backend/README.md` · `contracts/README.md` · `CLAUDE.md` (agent/dev guide)

---

**Secure Ticket** — *the convenience of Web2, the trust of Web3, on Stellar.*
