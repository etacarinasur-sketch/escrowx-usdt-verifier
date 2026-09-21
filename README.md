# ESCROW X — USDT Verifier v090 TRANSFER TOPIC REPAIR

Isolated successor to v089.

## Single repair
The verifier's `TRANSFER_TOPIC` constant is changed to the exact `topic0` observed in the v089 diagnostic for the submitted transaction.

## Unchanged
- BNB Smart Chain Mainnet, Chain ID 56
- USDT contract: `0x55d398326f99059fF775485246999027B3197955`
- Current ESCROW X custody receiver: `0xbf94435dc4e7233c50691e6bcabf52b778be4751`
- ANY_BSC_SENDER proof policy
- Sender/receiver/amount matching
- Confirmation checks
- Proof-only behavior
- No balance, Ledger, Treasury, wallet authorization, Deposit Intent, RBL or REVO changes

## Start command
```bash
node usdt-server-v090-transfer-topic-repair.js
```
