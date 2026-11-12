import { usePoll, near, ago, CONTRACT, RPC } from '../lib/data';
import { paymentInfo } from '../lib/x402-history';
import { Link } from '../lib/router';
import { CopyButton, State } from '../components/Ui';
import { PageHead } from '../components/Shell';
export function PaymentTabs({paid=false}:{paid?:boolean}){return <nav className="row-form" aria-label="API payment" style={{marginBottom:24}}><Link to="/keys" className={`btn btn-sm ${paid?'':'btn-w'}`} aria-current={!paid?'page':undefined}>API keys</Link><Link to="/keys/x402" className={`btn btn-sm ${paid?'btn-w':''}`} aria-current={paid?'page':undefined}>Pay with x402</Link></nav>;}
export function X402(){
 const state=usePoll(()=>paymentInfo(CONTRACT,RPC),10000);
 const d=state.data;const endpoint=d?.endpoint??'http://127.0.0.1:5421/v1/x402/chat/completions';
 const curl=`curl -i ${endpoint} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"model":"groq:openai/gpt-oss-20b","messages":[{"role":"user","content":"Explain sealed bids."}]}'`;
 return <><PageHead title="Pay with x402" art="coin" sub="Buy API calls with prepaid NEAR and signed vouchers. One batch settles many calls on testnet."/><PaymentTabs paid/>
 {!d&&!state.error&&<State kind="loading" title="Reading payment escrow"/>}
 {state.error&&<State kind="error" title="Payment history could not be read">{state.error}</State>}
 {d&&!d.enabled&&<State kind="setup" title="Payment service setup required">{d.setup}</State>}
 {d?.enabled&&<><p className="note">{d.source==='chain'?'from chain · current pricing requires the gateway':`${near(d.price,4)} NEAR per call`} · escrow <a className="link" target="_blank" rel="noreferrer" href={`https://testnet.nearblocks.io/address/${d.contract}`}>{d.contract}</a> · {d.pending===null?'pending calls unavailable':`${d.pending} awaiting batch settlement`}</p>
 <section className="sec"><div className="sec-h"><div><h2>Prepay once. Sign each call.</h2><p>An unpaid request returns HTTP 402. The client checks the price, network, merchant and request before signing with its ed25519 function-call key. Calls return before settlement; the merchant batches up to 32 vouchers within their two-minute expiry.</p></div></div>
 <div className="codebox"><div className="codebox-h"><span>curl · payment requirement</span><CopyButton text={curl} className="btn btn-sm btn-ghost"/></div><pre>{curl}</pre></div>
 <div className="codebox" style={{marginTop:10}}><div className="codebox-h"><span>TypeScript · signed retry</span></div><pre>{`import { payX402 } from '@xorv/sdk';
// See examples/x402-client.ts for the key-by-path signer.
await payX402('${endpoint}', request, {
  buyer: 'your-account.testnet',
  contract: '${d.contract}', merchant: '${d.merchant}',
  maxPrice: '${d.price}', sign: signWithFunctionCallKey
});`}</pre></div>
 <p className="note" style={{marginTop:12}}>This is Xorv's custom near-batch-v1 x402-style scheme. It serves Groq directly; these calls do not run individual sealed-bid auctions or spot checks. Unused prepaid NEAR can be refunded after a two-minute closing window. New prepaid accounts retain 0.005 NEAR for storage.</p></section>
 <section className="sec"><div className="sec-h"><div><h2>Batch settlements</h2><p>Confirmed on NEAR. Links use the merchant journal or matching final chain receipts.</p></div></div>
 {!d.batches.length?<State kind="empty" title="No settled batches yet">Accepted calls stay pending until the merchant submits a batch.</State>:<div className="tbl-wrap"><table className="tbl"><thead><tr><th>Batch</th><th className="r">Calls</th><th className="r">Paid</th><th>When</th><th>Transaction</th></tr></thead><tbody>{d.batches.map(b=><tr key={b.id}><td>#{b.id}</td><td className="r num">{b.calls}</td><td className="r num">{near(b.total,4)} NEAR</td><td>{ago(b.settled_ms)}</td><td>{b.tx?<><a className="link" href={`https://testnet.nearblocks.io/txns/${b.tx}`} target="_blank" rel="noreferrer">{b.tx.slice(0,8)}… ↗</a>{b.source==='chain'&&<span className="faint"> · from chain</span>}</>:<span className="faint">Receipt link unavailable</span>}</td></tr>)}</tbody></table></div>}</section></>}
 </>;
}
