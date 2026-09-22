import { execFileSync } from 'node:child_process';

export function descendantPids(table, root) {
  const rows = table.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const result = [], visited = new Set([root]);
  const walk = parent => {
    for (const [pid, ppid] of rows) {
      if (ppid !== parent || !Number.isInteger(pid) || pid <= 1 || visited.has(pid)) continue;
      visited.add(pid); walk(pid); result.push(pid);
    }
  };
  walk(root);
  return result;
}

/** PTYs create their own sessions, so killing only the backend PID leaves them alive. */
export function stopOwnedUnixTree(pid) {
  try {
    const table = execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 2000 });
    for (const child of descendantPids(table, pid)) {
      try { process.kill(child, 'SIGKILL'); } catch { /* already gone */ }
    }
  } catch { /* still terminate the backend */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}
