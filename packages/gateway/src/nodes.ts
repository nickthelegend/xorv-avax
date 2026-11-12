import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '@xorv/sdk/node';

export interface NodeSpec { label: string; margin: number; keeper: boolean; fault: 'none' | 'deliver' | 'check'; models?: string }
export interface NodeStatus { label: string; margin: number; keeper: boolean; fault: string; up: boolean; ready: boolean; pid: number | null; restarts: number; last_error: string | null }

/** "atlas:1.2,birch:1.08,cobalt:1.35,dune:1.15:deliver" → specs; the first node is the keeper. */
export function parseNodes(s: string | undefined): NodeSpec[] {
  return (s ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x, i) => {
    const [label, margin, fault] = x.split(':');
    const m = Number(margin ?? '1.2');
    if (!/^[a-z0-9-]+$/.test(label) || !(m > 0)) throw new Error(`bad node spec "${x}" (use label:margin[:fault])`);
    if (fault && !['deliver', 'check'].includes(fault)) throw new Error(`bad fault "${fault}" in "${x}" (deliver or check)`);
    return { label, margin: m, keeper: i === 0, fault: (fault as NodeSpec['fault']) ?? 'none' };
  });
}

/**
 * Runs provider nodes on this machine. Each node process gets only the allowlisted provider
 * variables (GROQ_API_KEY), never the gateway's desk key; it reads its own node key by name.
 */
export class NodePool {
  private procs = new Map<string, { spec: NodeSpec; child: ChildProcess | null; status: NodeStatus }>();
  private stopping = false;
  private specs: NodeSpec[];
  private env: Record<string, string>;
  constructor(specs: NodeSpec[], env: Record<string, string>) {
    this.specs = specs;
    this.env = env;
  }

  start() {
    for (const spec of this.specs) {
      this.procs.set(spec.label, { spec, child: null, status: { label: spec.label, margin: spec.margin, keeper: spec.keeper, fault: spec.fault, up: false, ready: false, pid: null, restarts: 0, last_error: null } });
      this.launch(spec.label);
    }
  }

  private launch(label: string) {
    if (this.stopping) return;
    const p = this.procs.get(label)!;
    const s = p.spec;
    const args = [path.join(ROOT, 'packages/node/src/cli.ts'), 'start', '--label', label, '--margin', String(s.margin), ...(s.models ? ['--models', s.models] : []), ...(s.keeper ? ['--keeper'] : []), ...(s.fault !== 'none' ? ['--fault', s.fault] : [])];
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...this.env };
    for (const k of ['XORV_DEPLOYMENT', 'XORV_RPC', 'XORV_STATE_DIR', 'XORV_SKIP_PREFLIGHT']) if (process.env[k]) env[k] = process.env[k]!;
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.child = child;
    p.status = { ...p.status, up: true, pid: child.pid ?? null };
    const tag = `[node ${label}]`;
    child.stdout?.on('data', (d) => {
      if (String(d).includes('XORV_NODE_READY')) p.status.ready = true;
      process.stdout.write(`${String(d).split('\n').filter(Boolean).map((l) => `${tag} ${l}`).join('\n')}\n`);
    });
    child.stderr?.on('data', (d) => {
      const t = String(d).trim();
      if (!t) return;
      p.status.last_error = t.split('\n').pop()!.slice(0, 240);
      process.stderr.write(`${tag} ${t}\n`);
    });
    child.on('exit', (code) => {
      p.status = { ...p.status, up: false, ready: false, pid: null };
      p.child = null;
      if (this.stopping) return;
      if (p.status.restarts < 3) {
        p.status.restarts += 1;
        setTimeout(() => this.launch(label), 3000 * p.status.restarts);
      } else p.status.last_error = `exited (code ${code}) after 3 restarts; see the gateway log`;
    });
  }

  stop() {
    this.stopping = true;
    for (const p of this.procs.values()) p.child?.kill('SIGTERM');
  }
  status(): NodeStatus[] {
    return [...this.procs.values()].map((p) => p.status);
  }
  online() {
    return this.status().filter((s) => s.up && s.ready);
  }
}
