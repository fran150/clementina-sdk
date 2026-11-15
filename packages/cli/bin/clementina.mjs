#!/usr/bin/env node
// `clementina mcp` hands stdio to the MCP server, which keeps the process alive
// until the host closes it; every other command runs once and exits. Tools
// from `clementina install` are added to the end of PATH for both. In dev mode
// (`clementina dev on`) the installed CLI runs the dev build of the CLI instead.
const {useInstalledTools} = await import('../dist/install.js');
const {devLaunch, devNotice, runDevBuild} = await import('../dist/dev.js');
const args = process.argv.slice(2);
const notice = devNotice(args);
if (notice) process.stderr.write(notice);
const launch = devLaunch(args);
if (launch) {
  process.exitCode = await runDevBuild(launch);
} else {
  useInstalledTools();
  if (args.length === 1 && args[0] === 'mcp') {
    const {serveMcp} = await import('../dist/mcp.js');
    serveMcp();
  } else {
    const {runCli} = await import('../dist/index.js');
    process.exitCode = await runCli(args, {
      stdout: text => process.stdout.write(text),
      stderr: text => process.stderr.write(text),
    });
  }
}
