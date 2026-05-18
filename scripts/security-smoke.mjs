import { spawn } from 'node:child_process';
import process from 'node:process';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const START_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.status >= 200 && res.status < 500) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`Server not ready within ${START_TIMEOUT_MS}ms`);
}

async function getStatus(path, token = null) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  return res.status;
}

async function main() {
  // Note: do NOT pass shell:true with args — Node deprecates that pattern
  // because the args aren't shell-escaped. Resolve `node` ourselves so
  // Windows finds it without needing a shell.
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  try {
    await waitForReady();

    const checks = [];
    checks.push(['unauth /api/servers', await getStatus('/api/servers'), 401]);
    checks.push(['unauth /api/permissions', await getStatus('/api/permissions'), 401]);
    checks.push(['unauth /api/keys', await getStatus('/api/keys'), 401]);

    const username = process.env.SMOKE_USERNAME;
    const password = process.env.SMOKE_PASSWORD;
    if (username && password) {
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      checks.push(['auth login', loginRes.status, 200]);
      if (loginRes.ok) {
        const loginData = await loginRes.json();
        const token = loginData.token;
        checks.push(['auth /api/servers', await getStatus('/api/servers', token), 200]);
        checks.push(['auth /api/permissions', await getStatus('/api/permissions', token), 200]);
      }
    }

    let failed = false;
    for (const [name, actual, expected] of checks) {
      const ok = actual === expected;
      if (!ok) failed = true;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: expected=${expected} actual=${actual}`);
    }

    if (failed) {
      process.exitCode = 1;
    }
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    if (!child.killed) child.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error(`Smoke test failed: ${err.message}`);
  process.exit(1);
});
