import { rpc, TESTNET_RPCS, viewClient } from '@xorv/sdk';

export type Batch = { id:number; calls:number; total:string; settled_ms:number; merchant:string; hash:string };
export type BatchRow = Batch & { tx:string|null; source?:'chain' };
export type PaymentInfo = { enabled:boolean; endpoint?:string; contract:string; merchant:string; price:string; pending:number|null; batches:BatchRow[]; setup?:string; source?:'chain' };
const object = (v:unknown):Record<string,unknown>|null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : null;
const integer = (v:unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const txHash = (v:unknown):v is string => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(v);

/** Accept only the contract's batch schema, never a made-up success from an HTTP status. */
export function parseBatch(v:unknown):Batch|null {
 const b=object(v);
 if(!b || !integer(b.id) || !integer(b.calls) || Number(b.calls)<1 || Number(b.calls)>32 || !integer(b.settled_ms) ||
  typeof b.total!=='string' || !/^[1-9][0-9]*$/.test(b.total) || typeof b.merchant!=='string' || !/^[a-z0-9._-]+\.testnet$/.test(b.merchant) ||
  typeof b.hash!=='string' || !/^[a-f0-9]{64}$/.test(b.hash))return null;
 return {id:b.id as number,calls:b.calls as number,total:b.total,settled_ms:b.settled_ms as number,merchant:b.merchant,hash:b.hash};
}

/** Only final, successful x402_settle receipts executed by this escrow can supply links. */
export function parseBatchReceipt(value:unknown,contract:string):BatchRow[] {
 const result=object(value),transaction=object(result?.transaction),status=object(result?.status);
 if(result?.final_execution_status!=='FINAL' || !status || !('SuccessValue' in status) || 'Failure' in status ||
  transaction?.receiver_id!==contract || !txHash(transaction.hash) || !Array.isArray(transaction.actions) ||
  !transaction.actions.some(a=>object(object(a)?.FunctionCall)?.method_name==='x402_settle'))return [];
 const rows:BatchRow[]=[];
 if(!Array.isArray(result.receipts_outcome))return rows;
 for(const receipt of result.receipts_outcome){
  const outcome=object(object(receipt)?.outcome),receiptStatus=object(outcome?.status);
  if(outcome?.executor_id!==contract || !receiptStatus || !('SuccessValue' in receiptStatus) || 'Failure' in receiptStatus || !Array.isArray(outcome.logs))continue;
  for(const line of outcome.logs){
   if(typeof line!=='string' || !line.startsWith('EVENT_JSON:'))continue;
   try{
    const event=JSON.parse(line.slice(11));
    if(event.standard!=='xorv'||event.version!=='1.0.0'||event.event!=='x402_batch'||!Array.isArray(event.data))continue;
    for(const data of event.data){const batch=parseBatch(data);if(batch && batch.merchant===transaction.signer_id)rows.push({...batch,tx:transaction.hash,source:'chain'});}
   }catch{/* Ignore malformed/unrelated logs. */}
  }
 }
 return rows;
}

export function matchBatchReceipt(batch:Batch,receipts:BatchRow[]):BatchRow {
 const found=receipts.find(r=>r.id===batch.id && r.calls===batch.calls && r.total===batch.total && r.merchant===batch.merchant && r.hash===batch.hash && r.settled_ms===batch.settled_ms);
 return {...batch,tx:found?.tx??null,source:'chain'};
}

// An indexer only discovers hashes. RPC final receipts and contract views verify every row/link.
const receipts=new Map<string,BatchRow[]>();
const discoveries=new Map<string,{at:number;rows:BatchRow[]}>();
async function discoverReceipts(contract:string,urls:string[],batches:Batch[]):Promise<BatchRow[]> {
 const cached=discoveries.get(contract);if(cached && Date.now()-cached.at<60000)return cached.rows;
 const rows:BatchRow[]=[];
 try{
  // Search the actual settlement window so later account activity cannot hide batch #0.
  const before=(BigInt(Math.max(...batches.map(b=>b.settled_ms)))+2000n)*1000000n;
  const query=new URLSearchParams({before_ts:before.toString(),limit:'100'});
  const response=await fetch(`https://api-testnet.nearblocks.io/v3/accounts/${encodeURIComponent(contract)}/txns?${query}`,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Indexer unavailable');
  const body=await response.json();
  if(!Array.isArray(body.data))throw Error('Invalid transaction index');
  for(const candidate of body.data){
   if(candidate.receiver_account_id!==contract || candidate.outcomes?.status!==true || !txHash(candidate.transaction_hash) ||
    !candidate.actions?.some((a:{method?:string})=>a.method==='x402_settle') || typeof candidate.signer_account_id!=='string')continue;
   const key=contract+':'+candidate.transaction_hash;
   let parsed=receipts.get(key);
   if(!parsed){
    const final=await rpc<unknown>(urls,'tx',{tx_hash:candidate.transaction_hash,sender_account_id:candidate.signer_account_id,wait_until:'FINAL'});
    if(object(object(final)?.transaction)?.hash!==candidate.transaction_hash)continue;
    parsed=parseBatchReceipt(final,contract);if(parsed.length)receipts.set(key,parsed);
   }
   rows.push(...parsed);
  }
 }catch{/* Views still give real rows when the indexer or receipt lookup is unavailable. */}
 discoveries.set(contract,{at:Date.now(),rows});return rows;
}

export async function chainPaymentInfo(contract:string,rpcUrl:string):Promise<PaymentInfo> {
 if(!contract.endsWith('.testnet'))throw Error('Testnet payment history only');
 const chain=viewClient(contract,rpcUrl);
 const [config,raw]=await Promise.all([chain.view<{network:string;scheme:string}>('x402_config'),chain.view<unknown>('x402_batches',{from:0,limit:100})]);
 if(config.network!=='near:testnet'||config.scheme!=='near-batch-v1'||!Array.isArray(raw))throw Error('Invalid payment contract');
 const batches=raw.map(parseBatch);if(batches.some(b=>!b))throw Error('Invalid batch history');
 const indexed=batches.length?await discoverReceipts(contract,[rpcUrl,...TESTNET_RPCS.filter(u=>u!==rpcUrl)],batches as Batch[]):[];
 return {enabled:true,contract,merchant:batches.at(-1)?.merchant??'xorv-ikic2.testnet',price:'1000000000000000000000',pending:null,
  source:'chain',batches:(batches as Batch[]).map(b=>matchBatchReceipt(b,indexed))};
}

export async function paymentInfo(contract:string,rpcUrl:string):Promise<PaymentInfo> {
 try{
  const r=await fetch('/api/x402',{signal:AbortSignal.timeout(1500)});if(!r.ok)throw Error('Gateway unavailable');
  const info=await r.json() as PaymentInfo;
  if(info.enabled!==true || info.contract!==contract || !Array.isArray(info.batches))throw Error('Gateway unavailable');
  if(info.batches.some(b=>!b.tx)){
   try{const chain=await chainPaymentInfo(contract,rpcUrl);info.batches=info.batches.map(b=>b.tx?b:chain.batches.find(c=>c.id===b.id)??b);}catch{/* Keep the gateway's real rows. */}
  }
  return info;
 }catch{return chainPaymentInfo(contract,rpcUrl);}
}
