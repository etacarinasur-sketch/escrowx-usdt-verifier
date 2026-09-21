'use strict';

const http = require('http');

/*
 * ESCROW X — USDT verifier v085 ANY-WALLET
 *
 * IMPORTANT ARCHITECTURE RULE
 * ---------------------------
 * This server is ONLY the blockchain proof connector.
 * It does NOT decide who may receive credit and it NEVER changes balances,
 * Ledger, Treasury, Deposit Intent state, Cold Wallet authorization, or
 * Financial Integrity state.
 *
 * Any valid BSC wallet may be the blockchain sender. Attribution/credit is
 * decided later by EscrowX according to its financial rules:
 *   - EXCHANGE: a valid Deposit Intent is required before credit.
 *   - COLD WALLET: the sender must satisfy EscrowX's registered/authorized
 *     sender-wallet rule before credit.
 *   - An otherwise valid but unattributed deposit is proof only and must not
 *     auto-credit a user.
 */

const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const USDT_RECEIVER = '0xbf94435dc4e7233c50691e6bcabf52b778be4751'; // EscrowX official USDT custody; intentionally code-locked to prevent Render env drift.
const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org';
const BSC_CHAIN_ID = 56;
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const USDT_DECIMALS = 18;
const MIN_CONFIRMATIONS = 2;
const RPC_TIMEOUT_MS = 7000;
const VERIFY_DEADLINE_MS = 18000;
const BODY_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 100000;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952b7f163c4a11628f55a4df523b3ef';
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_RE = /^0x[a-fA-F0-9]{64}$/;

function json(res, status, payload) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.end(JSON.stringify(payload));
}

function normalizeAddress(a) { return String(a || '').trim().toLowerCase(); }
function padAddressTopic(a) { return '0x' + normalizeAddress(a).slice(2).padStart(64, '0'); }
function hexToBigInt(x) { return BigInt(String(x || '0')); }
function formatUnits(value, decimals) {
  const n = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}
function decimalToUnits(input) {
  const s = String(input ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) throw new Error('Invalid USDT amount.');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > USDT_DECIMALS) throw new Error('USDT amount has more than 18 decimal places.');
  return BigInt(whole) * (10n ** 18n) + BigInt((frac + '0'.repeat(18)).slice(0, 18));
}

function deadlineSignal(timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  return { ctl, timer };
}

async function rpc(method, params = [], parentSignal = null) {
  const local = deadlineSignal(RPC_TIMEOUT_MS);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, local.ctl.signal])
    : local.ctl.signal;
  try {
    const r = await fetch(BSC_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal
    });
    if (!r.ok) throw new Error(`BSC RPC HTTP ${r.status}.`);
    const p = await r.json();
    if (p.error) throw new Error(p.error.message || 'BSC RPC returned an error.');
    return p.result;
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(parentSignal?.aborted ? 'USDT verification deadline exceeded.' : 'BSC RPC request timed out.');
    throw e;
  } finally {
    clearTimeout(local.timer);
  }
}

async function verifyUSDT(body) {
  const verifyCtl = new AbortController();
  const verifyTimer = setTimeout(() => verifyCtl.abort(), VERIFY_DEADLINE_MS);
  try {
    const amountInput = String(body.amount ?? '').trim();
    const txHash = String(body.txHash || '').trim();
    const from = String(body.from || '').trim();
    const receiver = String(body.receiver || USDT_RECEIVER).trim();

    // OPEN-SOURCE WALLET RULE: sender may be ANY valid BSC address.
    if (!TX_RE.test(txHash)) throw new Error('Enter a valid BSC transaction hash.');
    if (!ADDRESS_RE.test(from)) throw new Error('Enter a valid USDT sender address.');
    if (!ADDRESS_RE.test(receiver)) throw new Error('USDT custody receiver is not a valid BSC address.');
    if (normalizeAddress(receiver) !== normalizeAddress(USDT_RECEIVER)) throw new Error('USDT receiver does not match the configured ESCROW X custody address.');
    const requestedUnits = decimalToUnits(amountInput);
    if (requestedUnits <= 0n) throw new Error('Enter a valid USDT amount.');

    const chainIdHex = await rpc('eth_chainId', [], verifyCtl.signal);
    const chainId = Number.parseInt(chainIdHex, 16);
    if (chainId !== BSC_CHAIN_ID) throw new Error(`Connected RPC is not BSC Mainnet. Chain ID returned: ${chainId}.`);

    // Run independent chain reads concurrently so a slow RPC call does not
    // unnecessarily serialize the whole verification flow.
    const [tx, receipt, latestHex] = await Promise.all([
      rpc('eth_getTransactionByHash', [txHash], verifyCtl.signal),
      rpc('eth_getTransactionReceipt', [txHash], verifyCtl.signal),
      rpc('eth_blockNumber', [], verifyCtl.signal)
    ]);

    if (!tx) throw new Error('BSC transaction was not found. No balance was changed.');
    const txFrom = normalizeAddress(tx.from);
    if (txFrom !== normalizeAddress(from)) throw new Error('Blockchain sender does not match the submitted USDT sender. No balance was changed.');

    if (!receipt) throw new Error('BSC transaction is not confirmed yet. No balance was changed.');
    if (String(receipt.status || '').toLowerCase() !== '0x1') throw new Error('BSC transaction failed. No balance was changed.');

    const contract = normalizeAddress(USDT_CONTRACT);
    const wantedToTopic = padAddressTopic(receiver).toLowerCase();
    const wantedFromTopic = padAddressTopic(from).toLowerCase();
    const transfers = [];

    for (const log of (receipt.logs || [])) {
      if (normalizeAddress(log.address) !== contract) continue;
      const topics = Array.isArray(log.topics) ? log.topics : [];
      if (String(topics[0] || '').toLowerCase() !== TRANSFER_TOPIC) continue;
      if (topics.length < 3) continue;
      if (String(topics[1] || '').toLowerCase() !== wantedFromTopic) continue;
      if (String(topics[2] || '').toLowerCase() !== wantedToTopic) continue;
      const units = hexToBigInt(log.data || '0x0');
      transfers.push({ units, logIndex: Number.parseInt(String(log.logIndex || '0x0'), 16) || 0 });
    }

    if (!transfers.length) throw new Error('No matching USDT Transfer event from the submitted sender to the ESCROW X custody address was found. No balance was changed.');

    const matching = transfers.find(x => x.units === requestedUnits);
    if (!matching) {
      const actual = formatUnits(transfers[0].units, USDT_DECIMALS);
      throw new Error(`Amount mismatch: blockchain shows ${actual} USDT, but you entered ${amountInput} USDT. No balance was changed.`);
    }

    const latest = Number.parseInt(latestHex, 16);
    const blockNumber = Number.parseInt(String(receipt.blockNumber || '0x0'), 16);
    if (!Number.isFinite(latest) || !Number.isFinite(blockNumber) || blockNumber <= 0) throw new Error('BSC block number could not be verified.');

    const blockData = await rpc('eth_getBlockByNumber', [String(receipt.blockNumber || '0x0'), false], verifyCtl.signal);
    const blockTimestamp = Number.parseInt(String(blockData?.timestamp || '0x0'), 16);
    if (!Number.isFinite(blockTimestamp) || blockTimestamp <= 0) throw new Error('BSC block timestamp could not be verified.');

    const confirmations = Math.max(0, latest - blockNumber + 1);
    if (confirmations < MIN_CONFIRMATIONS) throw new Error(`USDT transaction is confirmed but only has ${confirmations} BSC confirmation(s). Wait for at least ${MIN_CONFIRMATIONS} confirmations and retry. No balance was changed.`);

    return {
      ok: true,
      realConnector: true,
      verifierVersion: 'v085',
      verificationScope: 'BLOCKCHAIN_PROOF_ONLY',
      walletPolicy: 'ANY_BSC_SENDER',
      financialCredit: 'ESCROW_X_ONLY',
      txHash: txHash.toLowerCase(),
      from: txFrom,
      to: normalizeAddress(receiver),
      amount: formatUnits(matching.units, USDT_DECIMALS),
      amountUnits: matching.units.toString(),
      status: 'SUCCESS',
      action: 'TRANSFER',
      asset: 'USDT',
      network: 'BNB Smart Chain · BEP-20',
      chainId: BSC_CHAIN_ID,
      tokenContract: USDT_CONTRACT,
      decimals: USDT_DECIMALS,
      blockIndex: blockNumber,
      blockTimestamp,
      confirmations,
      logIndex: matching.logIndex,
      verificationMode: 'BNB SMART CHAIN RPC · USDT TRANSFER EVENT',
      attributionRequired: true,
      balanceChangedByServer: false
    };
  } finally {
    clearTimeout(verifyTimer);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (req.method === 'GET' && req.url === '/health') {
    try {
      const chainIdHex = await rpc('eth_chainId');
      const chainId = Number.parseInt(chainIdHex, 16);
      return json(res, 200, {
        ok: chainId === BSC_CHAIN_ID,
        rpcConnected: true,
        chainId,
        network: 'BNB Smart Chain Mainnet',
        tokenContract: USDT_CONTRACT,
        receiver: USDT_RECEIVER,
        verifierVersion: 'v085',
        verificationScope: 'BLOCKCHAIN_PROOF_ONLY',
        walletPolicy: 'ANY_BSC_SENDER',
        balanceChangedByServer: false
      });
    } catch (e) {
      return json(res, 503, { ok: false, rpcConnected: false, error: e.message });
    }
  }

  if (req.method === 'POST' && req.url === '/usdt-verify-server') {
    let raw = '';
    let bodyBytes = 0;
    let ended = false;
    const bodyTimer = setTimeout(() => {
      if (!ended) {
        ended = true;
        try { req.destroy(); } catch (_) {}
      }
    }, BODY_TIMEOUT_MS);

    req.on('data', c => {
      if (ended) return;
      bodyBytes += c.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        ended = true;
        clearTimeout(bodyTimer);
        return json(res, 413, { ok: false, error: 'Request body too large.' });
      }
      raw += c;
    });

    req.on('end', async () => {
      if (ended) return;
      ended = true;
      clearTimeout(bodyTimer);
      try {
        const body = JSON.parse(raw || '{}');
        const proof = await verifyUSDT(body);
        return json(res, 200, proof);
      } catch (e) {
        const message = e?.message || 'USDT transaction could not be verified.';
        const status = /deadline exceeded|timed out|RPC|not found|not confirmed|failed|mismatch|No matching|Invalid|Enter a valid/i.test(message) ? 400 : 500;
        return json(res, status, { ok: false, error: message, verifierVersion: 'v085', balanceChangedByServer: false });
      }
    });
    return;
  }

  return json(res, 404, { ok: false, error: 'Not found.' });
});

server.requestTimeout = BODY_TIMEOUT_MS;
server.headersTimeout = BODY_TIMEOUT_MS + 2000;
server.keepAliveTimeout = 5000;

server.listen(PORT, '0.0.0.0', () => console.log(`ESCROW X USDT verifier v085 ANY-WALLET listening on port ${PORT}`));
