#!/usr/bin/env node
// MCP server (stdio): `node packages/mcp/src/main.ts`. Tools: xorv_index, xorv_models, xorv_job, xorv_ask.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, runTool } from './tools.ts';

const server = new Server({ name: 'xorv', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as any }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const out = await runTool(req.params.name, req.params.arguments ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
  }
});
await server.connect(new StdioServerTransport());
