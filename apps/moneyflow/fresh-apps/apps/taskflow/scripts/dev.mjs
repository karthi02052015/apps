#!/usr/bin/env node
/**
 * Runs the API and web dev servers together with prefixed, coloured output.
 * Zero dependencies; Ctrl+C stops both.
 */
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const procs = [
  { name: 'api', color: '\x1b[36m', args: ['run', 'dev', '-w', '@taskflow/api'] },
  { name: 'web', color: '\x1b[35m', args: ['run', 'dev', '-w', '@taskflow/web'] },
];

const children = procs.map(({ name, color, args }) => {
  const child = spawn(isWin ? 'npm.cmd' : 'npm', args, { stdio: ['inherit', 'pipe', 'pipe'], shell: isWin, env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) if (line.trim()) out.write(prefix + line + '\n');
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
