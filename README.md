# ESCROW X — USDT Verifier v084 ANY-WALLET

## Purpose
This server is a **blockchain proof connector only**. It verifies that a BNB Smart Chain transaction contains a successful USDT (BEP-20) transfer to the configured EscrowX custody receiver.

## Wallet rule
Any valid BSC sender wallet may submit a transaction for blockchain verification. The verifier does **not** maintain a wallet allowlist and does not decide user ownership.

## EscrowX financial attribution rules remain outside this server
- **EXCHANGE / Deposit Intent:** credit requires a valid Deposit Intent and the existing EscrowX Intent checks (exact amount, custody receiver, sender, anti-race, duplicate protection, expiry/status rules, etc.).
- **COLD WALLET:** this is a different flow. Credit requires EscrowX's registered/authorized permanent sender-wallet rule and its associated authorization-time and duplicate/traceability protections.
- A valid blockchain proof that cannot be safely attributed to a user must **not auto-credit** a balance. It remains proof for EscrowX administrative/review handling.

## Financial safety
This server never changes:
- user balances
- Ledger
- Treasury
- Deposit Intent state
- Cold Wallet authorization state
- Financial Integrity state

The response explicitly reports `balanceChangedByServer: false` and `attributionRequired: true` on success.

## Blockchain checks
- BNB Smart Chain Mainnet (chain ID 56)
- USDT BEP-20 contract: `0x55d398326f99059fF775485246999027B3197955`
- Configured custody receiver must match `USDT_RECEIVER`
- Sender must match the transaction's on-chain `from`
- Successful transaction receipt
- Matching USDT `Transfer` event from sender to custody receiver
- Exact requested amount
- At least 2 confirmations
- Block timestamp verified

## Reliability changes from v083
- The full verification has an 18-second deadline.
- Independent RPC reads are performed concurrently where possible.
- Each RPC has a 7-second timeout.
- Request-body timeout and size limits are enforced.
- No wallet-policy/credit decision is made by the server.

## Environment variables
- `PORT` (default `10000`)
- `ALLOWED_ORIGIN` (default `*`)
- `BSC_RPC_URL` (default `https://bsc-dataseed.bnbchain.org`)
- `USDT_RECEIVER` (default EscrowX custody receiver)

## Endpoint
`POST /usdt-verify-server`

Expected body:
```json
{
  "amount": "100",
  "txHash": "0x...",
  "from": "0x...",
  "receiver": "0xbf94435dc4e7233c50691e6bcabf52b778be4751"
}
```

## Important
Deploy this verifier as the new USDT verification server only after validating `/health` and one real test transaction. Do not change the existing EscrowX HTML financial attribution logic merely to make the generic verifier accept a wallet.
