'use strict';

const http = require('http');

/*
 * ESCROW X — USDT verifier v087 DEEP TRANSFER DIAGNOSTIC
 *
 * Isolated repair of the USDT Transfer-event matcher.
 * Blockchain proof only: this server NEVER changes balances, Ledger,
 * Treasury, Deposit Intent state, wallet authorization or Financial Integrity.
 * Any valid BSC sender may be the blockchain sender. EscrowX decides attribution.
 */

const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const USDT_RECEIVER = '0xbf94435dc4e7233c50691e6bcabf52b778be4751';
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

function json(res,status,payload){
  if(res.writableEnded)return;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin',ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.end(JSON.stringify(payload));
}
function normalizeAddress(a){return String(a||'').trim().toLowerCase();}
function topicAddress(t){
  const s=String(t||'').trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(s)?'0x'+s.slice(-40):'';
}
function padAddressTopic(a){return '0x'+normalizeAddress(a).slice(2).padStart(64,'0');}
function hexToBigInt(x){return BigInt(String(x||'0'));}
function formatUnits(value,decimals){
  const n=BigInt(value),base=10n**BigInt(decimals),whole=n/base;
  const frac=(n%base).toString().padStart(decimals,'0').replace(/0+$/,'');
  return frac?`${whole}.${frac}`:`${whole}`;
}
function decimalToUnits(input){
  const s=String(input??'').trim();
  if(!/^\d+(?:\.\d+)?$/.test(s))throw new Error('Invalid USDT amount.');
  const [whole,frac='']=s.split('.');
  if(frac.length>USDT_DECIMALS)throw new Error('USDT amount has more than 18 decimal places.');
  return BigInt(whole)*(10n**18n)+BigInt((frac+'0'.repeat(18)).slice(0,18));
}
function deadlineSignal(timeoutMs){const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),timeoutMs);return{ctl,timer};}
async function rpc(method,params=[],parentSignal=null){
  const local=deadlineSignal(RPC_TIMEOUT_MS);
  const signal=parentSignal?AbortSignal.any([parentSignal,local.ctl.signal]):local.ctl.signal;
  try{
    const r=await fetch(BSC_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method,params}),signal});
    if(!r.ok)throw new Error(`BSC RPC HTTP ${r.status}.`);
    const p=await r.json();
    if(p.error)throw new Error(p.error.message||'BSC RPC returned an error.');
    return p.result;
  }catch(e){
    if(e?.name==='AbortError')throw new Error(parentSignal?.aborted?'USDT verification deadline exceeded.':'BSC RPC request timed out.');
    throw e;
  }finally{clearTimeout(local.timer);}
}

async function verifyUSDT(body){
  const verifyCtl=new AbortController();
  const verifyTimer=setTimeout(()=>verifyCtl.abort(),VERIFY_DEADLINE_MS);
  try{
    const amountInput=String(body.amount??'').trim();
    const txHash=String(body.txHash||'').trim();
    const from=String(body.from||'').trim();
    const receiver=String(body.receiver||USDT_RECEIVER).trim();
    if(!TX_RE.test(txHash))throw new Error('Enter a valid BSC transaction hash.');
    if(!ADDRESS_RE.test(from))throw new Error('Enter a valid USDT sender address.');
    if(!ADDRESS_RE.test(receiver))throw new Error('USDT custody receiver is not a valid BSC address.');
    if(normalizeAddress(receiver)!==normalizeAddress(USDT_RECEIVER))throw new Error('USDT receiver does not match the configured ESCROW X custody address.');
    const requestedUnits=decimalToUnits(amountInput);
    if(requestedUnits<=0n)throw new Error('Enter a valid USDT amount.');

    const chainIdHex=await rpc('eth_chainId',[],verifyCtl.signal);
    const chainId=Number.parseInt(chainIdHex,16);
    if(chainId!==BSC_CHAIN_ID)throw new Error(`Connected RPC is not BSC Mainnet. Chain ID returned: ${chainId}.`);

    const [tx,receipt,latestHex]=await Promise.all([
      rpc('eth_getTransactionByHash',[txHash],verifyCtl.signal),
      rpc('eth_getTransactionReceipt',[txHash],verifyCtl.signal),
      rpc('eth_blockNumber',[],verifyCtl.signal)
    ]);
    if(!tx)throw new Error('BSC transaction was not found. No balance was changed.');
    const txFrom=normalizeAddress(tx.from);
    if(txFrom!==normalizeAddress(from))throw new Error('Blockchain sender does not match the submitted USDT sender. No balance was changed.');
    if(!receipt)throw new Error('BSC transaction is not confirmed yet. No balance was changed.');
    if(String(receipt.status||'').toLowerCase()!=='0x1')throw new Error('BSC transaction failed. No balance was changed.');

    const contract=normalizeAddress(USDT_CONTRACT);
    const wantedFrom=normalizeAddress(from);
    const wantedTo=normalizeAddress(receiver);
    const transfers=[];

    // REPAIRED: decode indexed Transfer addresses from the last 20 bytes of
    // topics[1]/topics[2], rather than requiring a pre-built 32-byte string.
    // This is semantically identical for standard ERC-20 Transfer events but
    // is more robust to RPC formatting/casing and gives deterministic diagnostics.
    for(const log of (Array.isArray(receipt.logs)?receipt.logs:[])){
      if(normalizeAddress(log?.address)!==contract)continue;
      const topics=Array.isArray(log?.topics)?log.topics:[];
      if(String(topics[0]||'').trim().toLowerCase()!==TRANSFER_TOPIC)continue;
      if(topics.length<3)continue;
      const logFrom=topicAddress(topics[1]);
      const logTo=topicAddress(topics[2]);
      let units;
      try{units=hexToBigInt(log.data||'0x0');}catch(_){continue;}
      transfers.push({from:logFrom,to:logTo,units,logIndex:Number.parseInt(String(log.logIndex||'0x0'),16)||0});
    }

    const fromMatches=transfers.filter(x=>x.from===wantedFrom);
    const destinationMatches=fromMatches.filter(x=>x.to===wantedTo);
    const amountMatches=destinationMatches.filter(x=>x.units===requestedUnits);

    if(!destinationMatches.length){
      // v087 DIAGNOSTIC ONLY: expose exactly what eth_getTransactionReceipt
      // returned for logs, without changing attribution, credit, or matching rules.
      const receiptLogs=Array.isArray(receipt.logs)?receipt.logs:[];
      const logDiagnostics=receiptLogs.slice(0,80).map((log,index)=>{
        const topics=Array.isArray(log?.topics)?log.topics:[];
        const topic0=String(topics[0]||'').trim().toLowerCase();
        const topic1=String(topics[1]||'').trim().toLowerCase();
        const topic2=String(topics[2]||'').trim().toLowerCase();
        return {
          index,
          address:String(log?.address||''),
          addressNormalized:normalizeAddress(log?.address),
          topicsCount:topics.length,
          topic0,
          topic1,
          topic2,
          topic1Address:topicAddress(topic1),
          topic2Address:topicAddress(topic2),
          data:String(log?.data||''),
          logIndex:String(log?.logIndex||'')
        };
      });
      const usdtLogs=logDiagnostics.filter(x=>x.addressNormalized===contract);
      const transferTopicLogs=usdtLogs.filter(x=>x.topic0===TRANSFER_TOPIC);
      const compactLogs=usdtLogs.slice(0,8).map(x=>({index:x.index,topic0:x.topic0,topicsCount:x.topicsCount,from:x.topic1Address,to:x.topic2Address,data:x.data,logIndex:x.logIndex}));
      const diagnostic={submittedFrom:wantedFrom,submittedReceiver:wantedTo,receiptLogCount:receiptLogs.length,usdtLogCount:usdtLogs.length,transferTopicLogCount:transferTopicLogs.length,transferTopic:TRANSFER_TOPIC,usdtLogs:compactLogs};
      const detail=JSON.stringify(diagnostic);
      throw new Error(`No matching USDT Transfer event from the submitted sender to the ESCROW X custody address was found. No balance was changed. Diagnostic=${detail}`);
    }
    if(!amountMatches.length){
      const actual=destinationMatches.map(x=>formatUnits(x.units,USDT_DECIMALS)).join(', ');
      throw new Error(`Amount mismatch: blockchain shows ${actual} USDT, but you entered ${amountInput} USDT. No balance was changed.`);
    }

    const matching=amountMatches[0];
    const latest=Number.parseInt(latestHex,16);
    const blockNumber=Number.parseInt(String(receipt.blockNumber||'0x0'),16);
    if(!Number.isFinite(latest)||!Number.isFinite(blockNumber)||blockNumber<=0)throw new Error('BSC block number could not be verified.');
    const blockData=await rpc('eth_getBlockByNumber',[String(receipt.blockNumber||'0x0'),false],verifyCtl.signal);
    const blockTimestamp=Number.parseInt(String(blockData?.timestamp||'0x0'),16);
    if(!Number.isFinite(blockTimestamp)||blockTimestamp<=0)throw new Error('BSC block timestamp could not be verified.');
    const confirmations=Math.max(0,latest-blockNumber+1);
    if(confirmations<MIN_CONFIRMATIONS)throw new Error(`USDT transaction is confirmed but only has ${confirmations} BSC confirmation(s). Wait for at least ${MIN_CONFIRMATIONS} confirmations and retry. No balance was changed.`);

    return {
      ok:true,realConnector:true,verifierVersion:'v088',verificationScope:'BLOCKCHAIN_PROOF_ONLY',walletPolicy:'ANY_BSC_SENDER',financialCredit:'ESCROW_X_ONLY',
      txHash:txHash.toLowerCase(),from:txFrom,to:wantedTo,amount:formatUnits(matching.units,USDT_DECIMALS),amountUnits:matching.units.toString(),status:'SUCCESS',action:'TRANSFER',asset:'USDT',
      network:'BNB Smart Chain · BEP-20',chainId:BSC_CHAIN_ID,tokenContract:USDT_CONTRACT,decimals:USDT_DECIMALS,blockIndex:blockNumber,blockTimestamp,confirmations,logIndex:matching.logIndex,
      verificationMode:'BNB SMART CHAIN RPC · USDT TRANSFER EVENT',attributionRequired:true,balanceChangedByServer:false
    };
  }finally{clearTimeout(verifyTimer);}
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS')return json(res,204,{});
  if(req.method==='GET'&&req.url==='/health'){
    try{
      const chainIdHex=await rpc('eth_chainId');
      const chainId=Number.parseInt(chainIdHex,16);
      return json(res,200,{ok:chainId===BSC_CHAIN_ID,rpcConnected:true,chainId,network:'BNB Smart Chain Mainnet',tokenContract:USDT_CONTRACT,receiver:USDT_RECEIVER,verifierVersion:'v088',verificationScope:'BLOCKCHAIN_PROOF_ONLY',walletPolicy:'ANY_BSC_SENDER',balanceChangedByServer:false});
    }catch(e){return json(res,503,{ok:false,rpcConnected:false,error:e.message});}
  }
  if(req.method==='POST'&&req.url==='/usdt-verify-server'){
    let raw='',bodyBytes=0,ended=false;
    const bodyTimer=setTimeout(()=>{if(!ended){ended=true;try{req.destroy();}catch(_){} }},BODY_TIMEOUT_MS);
    req.on('data',c=>{
      if(ended)return;
      bodyBytes+=c.length;
      if(bodyBytes>MAX_BODY_BYTES){ended=true;clearTimeout(bodyTimer);return json(res,413,{ok:false,error:'Request body too large.'});}
      raw+=c;
    });
    req.on('end',async()=>{
      if(ended)return;
      ended=true;clearTimeout(bodyTimer);
      try{
        const body=JSON.parse(raw||'{}');
        const proof=await verifyUSDT(body);
        return json(res,200,proof);
      }catch(e){
        const message=e?.message||'USDT transaction could not be verified.';
        const status=/deadline exceeded|timed out|RPC|not found|not confirmed|failed|mismatch|No matching|Invalid|Enter a valid/i.test(message)?400:500;
        return json(res,status,{ok:false,error:message,verifierVersion:'v088',balanceChangedByServer:false});
      }
    });
    return;
  }
  return json(res,404,{ok:false,error:'Not found.'});
});
server.requestTimeout=BODY_TIMEOUT_MS;
server.headersTimeout=BODY_TIMEOUT_MS+2000;
server.keepAliveTimeout=5000;
server.listen(PORT,'0.0.0.0',()=>console.log(`ESCROW X USDT verifier v087 DEEP TRANSFER DIAGNOSTIC listening on port ${PORT}`));
