# ESCROW X — USDT Verifier v087 DEEP TRANSFER DIAGNOSTIC

Isolated diagnostic descendant of v086.

## Purpose

Diagnose exactly what `eth_getTransactionReceipt` returns when the expected USDT `Transfer` event is not matched.

The diagnostic reports receipt log count, USDT-contract log count, Transfer-topic log count, topics, data, decoded indexed addresses, and parsed transfer candidates.

## Financial safety

- BSC Mainnet / chain ID 56.
- USDT contract: `0x55d398326f99059fF775485246999027B3197955`.
- Current EscrowX custody receiver: `0xbf94435dc4e7233c50691e6bcabf52b778be4751`.
- ANY_BSC_SENDER means any valid BSC sender can provide blockchain proof; it does not grant automatic account attribution.
- Proof only: the server never changes balances, Ledger, Treasury, Deposit Intent state, wallet authorization, or Financial Integrity.
- No new deposit is required for the diagnostic test; reuse the existing known TX.

## Start command

```bash
node usdt-server-v087-deep-transfer-diagnostic.js
```
