import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createClementinaMcpServer} from '@clementina/mcp';

/**
 * `clementina mcp`: serve the SDK's MCP tools over stdio, the same server as
 * the `clementina-mcp` npm binary, so the standalone executable needs no Node.js.
 * Standard output carries only MCP messages.
 */
export function serveMcp(): void {
  void serveStdio(createClementinaMcpServer);
}
