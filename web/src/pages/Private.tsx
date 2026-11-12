import { encryptedErcAbi } from '@xorv/sdk';
import { D, addrUrl, ago, money, nameOf, reader, short, txUrl, useMarket, useNow, usePoll } from '../lib/data';
import { gateway } from '../lib/gateway';
import { Link } from '../lib/router';
import { Icon, State } from '../components/Ui';
import { PageHead, Tag, Tile } from '../components/Shell';

async function readEercEvents() {
  const e = D.eerc!;
  const q = (eventName: string) => reader.logs({ address: e.encryptedERC, abi: encryptedErcAbi, eventName });
  const [t, dep, wd] = await Promise.all([q('PrivateTransfer'), q('Deposit'), q('Withdraw')]);
  return [...t.map((l) => ({ kind: 'transfer' as const, l })), ...dep.map((l) => ({ kind: 'deposit' as const, l })), ...wd.map((l) => ({ kind: 'withdraw' as const, l }))]
    .sort((a, b) => Number(b.l.blockNumber - a.l.blockNumber) || b.l.logIndex - a.l.logIndex);
}

export function Private() {
  const m = useMarket();
  const now = useNow(10_000);
  const e = D.eerc;
  const evs = usePoll(() => (e ? readEercEvents() : Promise.resolve([])), 20_000);
  const status = usePoll(() => gateway.privateStatus().catch(() => null), 30_000);
  if (!e) return <div className="wrap page"><State kind="setup" art="shield" title="eERC is not deployed here">This deployment has no EncryptedERC contracts.</State></div>;
  const rows = evs.data ?? [];
  const transfers = rows.filter((r) => r.kind === 'transfer');
  const who = (a?: string) => (a ? <a className="link mono-c" href={addrUrl(a)} target="_blank" rel="noreferrer">{nameOf(m.data, a)}</a> : '—');
  return (
    <div className="wrap page">
      <PageHead title="Private credit" art="shield" sub="Your AI spend, encrypted on Avalanche with Ava Labs' eERC. Competitors see that you paid the desk, never how much."
        actions={<Link to="/account/private" className="btn btn-w btn-sm"><Icon name="wallet" size={14} />My private credit</Link>} />
      <div className="feature-pair" style={{ marginTop: 0 }}>
        <div className="card card-pad">
          <h3>What is hidden</h3>
          <p>Top-up amounts to the desk, your remaining credit, and which chats are yours: the desk posts them under its own address. Provider treasuries can sweep earnings into eERC and pay out privately too.</p>
        </div>
        <div className="card card-pad">
          <h3>What stays public</h3>
          <p>Sender and receiver of each encrypted transfer, every deposit and withdrawal amount, and each job's cleared price, which is the whole point of the index. The auditor key can decrypt every amount for compliance.</p>
        </div>
      </div>
      <div className="tiles" style={{ marginTop: 20 }}>
        <Tile label="Encrypted transfers" value={evs.data ? transfers.length : '…'} note="amounts are ciphertexts" />
        <Tile label="Desk" value={D.eerc?.desk ? short(D.eerc.desk) : '—'} note={status.data?.enabled ? `${status.data.attributedTopups} top-ups attributed · ${status.data.privateJobs} private jobs` : status.data?.setup ?? 'gateway not reachable'} />
        <Tile label="Auditor" value={D.eerc?.auditor ? short(D.eerc.auditor) : '—'} note="can decrypt every amount" />
        <Tile label="Mode" value="Converter" note="wraps tUSD 1:1, 6 decimals" />
      </div>
      <section className="sec">
        <div className="sec-h"><div><h2>Every eERC event</h2><p>Read from the EncryptedERC contract on Fuji. A transfer's amount appears only as the auditor's ciphertext.</p></div><a href={addrUrl(e.encryptedERC)} target="_blank" rel="noreferrer">EncryptedERC <Icon name="external" size={13} /></a></div>
        {evs.error && !evs.data && <State kind="error" art="warning" title="Could not read eERC events" action={<button className="btn btn-sm" onClick={evs.reload}>Retry</button>}>{evs.error}</State>}
        {!evs.data && !evs.error && <div className="skeleton sk-row" />}
        {evs.data && !rows.length && <State kind="empty" art="empty" title="No eERC activity yet">The first deposit or encrypted transfer shows up here.</State>}
        {rows.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Event</th><th>From</th><th>To</th><th className="r">Amount</th><th className="r">When</th><th className="r">Tx</th></tr></thead>
              <tbody>
                {rows.slice(0, 40).map(({ kind, l }) => (
                  <tr key={l.transactionHash + kind}>
                    <td>{kind === 'transfer' ? <Tag tone="info">Encrypted transfer</Tag> : kind === 'deposit' ? <Tag tone="dim">Deposit</Tag> : <Tag tone="dim">Withdraw</Tag>}</td>
                    <td>{who(kind === 'transfer' ? l.args.from : kind === 'deposit' ? l.args.user : l.args.user)}</td>
                    <td>{kind === 'transfer' ? who(l.args.to) : <span className="faint">{kind === 'deposit' ? 'own eERC balance' : 'own tUSD'}</span>}</td>
                    <td className="r num">{kind === 'transfer' ? <span className="faint mono-c" title="auditor ciphertext (Poseidon), not the amount">0x{BigInt(l.args.auditorPCT[0]).toString(16).slice(0, 10)}…</span> : money(l.args.amount)}</td>
                    <td className="r faint">{l.timeStamp ? ago(Number(l.timeStamp), now) : '—'}</td>
                    <td className="r"><a className="link mono-c" href={txUrl(l.transactionHash)} target="_blank" rel="noreferrer">{l.transactionHash.slice(0, 10)}…</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="sec">
        <div className="sec-h"><div><h2>Contracts</h2><p>Ava Labs' official EncryptedERC (converter mode over tUSD), Registrar and Groth16 verifiers, unmodified.</p></div></div>
        <div className="card card-pad kv">
          {[['EncryptedERC', e.encryptedERC], ['Registrar', e.registrar], ['BabyJubJub library', e.babyJubJub], ...Object.entries(e.verifiers).map(([k, v]) => [`${k[0].toUpperCase()}${k.slice(1)} verifier`, v])].map(([k, v]) => (
            <div key={k}><span>{k}</span><a className="link mono-c" href={addrUrl(v)} target="_blank" rel="noreferrer">{short(v, 6)}</a></div>
          ))}
        </div>
      </section>
    </div>
  );
}
