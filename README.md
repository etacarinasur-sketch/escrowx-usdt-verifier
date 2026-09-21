# ESCROW X — USDT Verifier v089 EXPLICIT TOPIC MATCH

Isolated continuation of v088.

## Purpose

Diagnose and robustly compare the standard ERC-20 `Transfer` event indexed topics against the submitted sender and the fixed ESCROW X custody receiver.

## Fixed rules

- BSC Mainnet / Chain ID 56
- USDT contract: `0x55d398326f99059fF775485246999027B3197955`
- Current custody receiver: `0xbf94435dc4e7233c50691e6bcabf52b778be4751`
- Any valid BSC sender may provide blockchain proof
- Proof-only server
- Server never changes balances, Ledger, Treasury, Deposit Intent, wallet authorization, or Financial Integrity state

## v089 change

Only the Transfer-topic matching/diagnostic layer changes. It compares both the raw 32-byte indexed topics and their decoded last-20-byte addresses, and exposes the expected versus received values when no match is found.

## Start

`node usdt-server-v089-explicit-topic-match.js`
