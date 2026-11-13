#!/usr/bin/env node
/**
 * A minimal MCP client for trying the Xorv tools the way an agent sees them: it starts the xorv-mcp server over
 * stdio, lists its tools and calls one.
 *   node packages/mcp/src/call.ts                      list the tools
 *   node packages/mcp/src/call.ts xorv_index           call one (JSON arguments as the next argument)
 *   node packages/mcp/src/call.ts xorv_ask '{"prompt":"…","verify":true}'
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [tool, json] = process.argv.slice(2);
const server = path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.ts');
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: process.env as Record<string, string>, stderr: 'inherit' });
const client = new Client({ name: 'xorv-mcp-call', version: '0.1.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`MCP server xorv · ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
if (tool) {
  console.log(`→ tools/call ${tool} ${json ?? '{}'}`);
  const out: any = await client.callTool({ name: tool, arguments: json ? JSON.parse(json) : {} });
  for (const c of out.content ?? []) if (c.type === 'text') console.log(c.text);
  if (out.isError) process.exitCode = 1;
}
await client.close();
