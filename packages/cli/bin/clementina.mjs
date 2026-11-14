#!/usr/bin/env node
// `clementina mcp` hands stdio to the MCP server, which keeps the process alive
// until the host closes it; every other command runs once and exits.
if (process.argv.length === 3 && process.argv[2] === 'mcp') {
  const {serveMcp} = await import('../dist/mcp.js');
  serveMcp();
} else {
  const {runCli} = await import('../dist/index.js');
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
  });
}
