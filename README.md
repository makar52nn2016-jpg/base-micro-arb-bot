# Base Micro-Arb Bot — Autonomous CDP-powered arbitrage scanner

Autonomous Base L2 micro-arbitrage bot using:
- **Coinbase Developer Platform (CDP) SDK** — non-custodial wallet management
- **Free gas via Coinbase paymaster** — zero tx cost
- **GitHub Actions 24/7** — runs in cloud for free (2000 min/month)

## Quick Start

### Step 1: Get CDP API credentials

1. Go to https://portal.cdp.coinbase.com → sign in with Coinbase account
2. Create API key at https://portal.cdp.coinbase.com/api-keys/secret
   - Under Advanced settings, check **Non-custodial: Export** and **Non-custodial: Manage**
   - Keep **Ed25519** as signature algorithm
   - Download JSON — contains `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`
3. Generate Wallet Secret at https://portal.cdp.coinbase.com/wallets/non-custodial/security
   - Copy `CDP_WALLET_SECRET` (shown once)

### Step 2: Add GitHub Secrets

Go to https://github.com/makar52nn2016-jpg/base-micro-arb-bot/settings/secrets/actions and add:

- `CDP_API_KEY_ID` — from API key JSON
- `CDP_API_KEY_SECRET` — from API key JSON (private key value)
- `CDP_WALLET_SECRET` — from wallet security page

### Step 3: Fund your wallet

After first run, bot will print wallet address. Send 0.001 ETH ($3) to that address on Base mainnet via:
- Direct transfer from your Coinbase account
- Bridge from Ethereum via https://bridge.base.org
- Withdrawal from exchange (BingX, Binance, etc.)

### Step 4: Enable GitHub Actions

1. Go to https://github.com/makar52nn2016-jpg/base-micro-arb-bot/actions
2. Enable workflows
3. Manually trigger "Run micro-arb bot" workflow
4. Bot runs 24/7 (capped at GitHub Actions 2000 min/month free tier)

## How it works

```
Bot starts (GitHub Action)
    ↓
Initialize CDP wallet (create or load existing)
    ↓
Loop forever:
    ├─ Scan 11 pairs × 3 DEXes (Aerodrome V2, Slipstream, Uniswap V3)
    ├─ Find spread > $0.001
    ├─ Atomic swap via CDP SDK (free gas paymaster)
    ├─ Log result
    └─ Wait 60s
```

## Realistic expectations

Based on author of BaseBuster (Zacholme7, ⭐80 Base arb bot):
> "my hourly wage would be like $0.02 an hour"

**Realistic income with $6 capital + CDP + 24/7:**
- Atomic arb: $0.05-0.50/hour (free gas eliminates most cost)
- Stablecoin triangle: $0.01-0.10/hour
- Total realistic: **$0.10-1/hour average, $2-5 in volatile hours**

## Architecture

```
src/
├── bot.ts            # Main entry point — orchestration
├── cdp-client.ts     # CDP SDK wallet management
├── arb-scanner.ts    # Cross-DEX spread detection
├── swap-executor.ts  # Atomic swap via CDP
└── price-feeds.ts    # Real-time pool prices via Alchemy

.github/workflows/
└── run-bot.yml       # 24/7 cron job
```

## Disclaimer

This is real arbitrage, not a money printer. Most cycles will show 0 trades because spreads are too small to profit after gas. The bot is designed to capture micro-spreads when they appear.

If anyone promises $10/hour with $6 capital — that's a scam. Real ceiling with $6 + free gas = $0.10-2/hour.

## License

MIT
