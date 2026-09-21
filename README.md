# ESCROW X — USDT Verifier v086 TRANSFER-MATCH REPAIRED

Isolated repair of the USDT ERC-20 Transfer-event matching logic.

## What changed
- Decodes indexed Transfer `from`/`to` addresses from the final 20 bytes of topics[1]/topics[2].
- Keeps the official current custody receiver locked to `0xbf94435dc4e7233c50691e6bcabf52b778be4751`.
- Keeps BSC Chain ID 56 and the official USDT contract.
- Keeps ANY_BSC_SENDER policy at the proof layer.
- Adds deterministic diagnostics to a no-match error so the actual Transfer candidates can be inspected.

## What did NOT change
- No balance credit.
- No Ledger/Treasury mutation.
- No Deposit Intent attribution.
- No Cold Wallet authorization.
- No Financial Integrity state.
- No RBL/REVO/Rubi Connector.

## Render
Start command:
`node usdt-server-v086-transfer-match-repaired.js`
