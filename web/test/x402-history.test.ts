import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseBatch,parseBatchReceipt,matchBatchReceipt} from '../src/lib/x402-history.ts';

const contract='escrow.xorv-ikic2.testnet';
// Public final RPC receipt, fetched Nov 12. No journal, private token or credential.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/x402-batch.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(fixture);

test('parses the real final five-call batch receipt and exact transaction link',()=>{
 const rows=parseBatchReceipt(fixture,contract);
 assert.equal(rows.length,1);assert.equal(rows[0].id,0);assert.equal(rows[0].calls,5);
 assert.equal(rows[0].total,'5000000000000000000000');assert.equal(rows[0].source,'chain');
 assert.equal(rows[0].tx,'NJeugk7mR7BeP8ohAyEMa2ntPseVUKWu3oCdgwva8uk');
});
test('ignores nonfinal, failed, wrong-contract and wrong-method receipts',()=>{
 const pending=copy();pending.final_execution_status='EXECUTED_OPTIMISTIC';
 const failed=copy();failed.status={Failure:{error:'rejected'}};
 const wrongMethod=copy();wrongMethod.transaction.actions=[{FunctionCall:{method_name:'x402_deposit'}}];
 const wrongExecutor=copy();wrongExecutor.receipts_outcome.forEach((r:any)=>r.outcome.executor_id='other.testnet');
 for(const value of [pending,failed,wrongMethod,wrongExecutor])assert.deepEqual(parseBatchReceipt(value,contract),[]);
 assert.deepEqual(parseBatchReceipt(fixture,'other.testnet'),[]);
});
test('malformed and unrelated logs cannot create payment rows',()=>{
 const value=copy();value.receipts_outcome[0].outcome.logs=['EVENT_JSON:null','EVENT_JSON:{','not a payment'];
 assert.deepEqual(parseBatchReceipt(value,contract),[]);
 const foreign=copy();foreign.transaction.signer_id='other.testnet';assert.deepEqual(parseBatchReceipt(foreign,contract),[]);
 assert.equal(parseBatch({id:0,calls:5,total:'NaN'}),null);assert.deepEqual(parseBatchReceipt(null,contract),[]);
});
test('only a receipt identical to the live batch may supply its transaction link',()=>{
 const rows=parseBatchReceipt(fixture,contract),batch=rows[0];
 assert.equal(matchBatchReceipt(batch,rows).tx,batch.tx);
 for(const changed of [{total:'1'},{calls:4},{hash:'ab'.repeat(32)},{merchant:'other.testnet'},{settled_ms:batch.settled_ms+1},{id:1}]){
  assert.equal(matchBatchReceipt({...batch,...changed},rows).tx,null);
 }
 assert.equal(matchBatchReceipt(batch,[]).tx,null);
});
