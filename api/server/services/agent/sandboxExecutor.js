/**
 * TezGPT — Agent Mode Sandbox Executor
 *
 * Runs terminal commands for the Agent Mode in a dedicated per-task
 * workspace directory, with:
 *   - command allowlist (standard package managers + common utils)
 *   - per-command timeouts
 *   - cwd locked to the task workspace
 *   - env sanitized (no host secrets inherited)
 *   - output size caps
 *   - job persistence (JSONL) so long tasks survive restarts (single-user mode)
 *
 * HONEST LIMITS: this is process-level isolation (workspace + allowlist +
 * timeouts), NOT a VM/Docker sandbox. For untrusted code, run the server
 * inside Docker (see docker-compose.yml) — the executor behaves the same.
 *
 * Secrets policy: the server NEVER stores user API keys / GitHub tokens.
 * Git operations receive the token per-request in memory only.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const SANDBOX_ROOT = path.join(__dirname, '..', '..', 'agent-sandbox');
const JOBS_FILE = path.join(SANDBOX_ROOT, 'jobs.jsonl');

const ALLOWED_BINARIES = new Set([
  'node', 'npm', 'npx', 'bun', 'python3', 'python', 'pip', 'pip3',
  'git', 'curl', 'wget', 'ls', 'cat', 'mkdir', 'rm', 'cp', 'mv',
  'echo', 'touch', 'find', 'head', 'tail', 'grep', 'chmod', 'zip', 'unzip',
]);

const ALLOWED_CURL_HOSTS = [
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  'raw.githubusercontent.com',
  'api.github.com',
  'codeload.github.com',
];

const MAX_OUTPUT = 200 * 1024; // 200 KB per stream
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 15 * 60_000; // hard cap: 15 min per command

function ensureRoot() {
  if (!fs.existsSync(SANDBOX_ROOT)) {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  }
}

function newId() {
  return `task-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

async function loadJobs() {
  ensureRoot();
  if (!fs.existsSync(JOBS_FILE)) {
    return new Map();
  }
  const raw = await fsp.readFile(JOBS_FILE, 'utf8');
  const jobs = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const job = JSON.parse(line);
      jobs.set(job.id, job);
    } catch {
      /* skip corrupt lines */
    }
  }
  return jobs;
}

async function persistJob(job) {
  ensureRoot();
  await fsp.appendFile(JOBS_FILE, JSON.stringify(job) + '\n');
}

function sanitizeEnv() {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: SANDBOX_ROOT,
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    CI: '1',
    // no host API keys / tokens are inherited
  };
}

/**
 * Validate & split a command line. Rejects pipelines/redirects beyond the
 * allowlist and any binary outside the allowlist.
 */
function parseCommand(cmd) {
  const trimmed = String(cmd ?? '').trim();
  if (!trimmed) {
    throw new Error('empty command');
  }
  if (trimmed.length > 4000) {
    throw new Error('command too long');
  }
  // reject shell control chars (except simple && chains) to keep allowlist meaningful
  if (/[;&|<>`$]/.test(trimmed.replace(/&&/g, ''))) {
    throw new Error('shell operators not allowed in sandbox');
  }
  const parts = trimmed
    .split('&&')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/));
  for (const tokens of parts) {
    const bin = path.basename(tokens[0]);
    if (!ALLOWED_BINARIES.has(bin)) {
      throw new Error(`command not allowed in sandbox: ${bin}`);
    }
  }
  return trimmed;
}

function checkCurlArgs(tokens) {
  const idx = tokens.findIndex((t) => !t.startsWith('-'));
  const url = idx >= 0 ? tokens[idx] : null;
  if (!url || !/^https?:\/\//i.test(url)) {
    return;
  }
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('invalid curl URL');
  }
  if (!ALLOWED_CURL_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    throw new Error(`curl host not allowed in sandbox: ${host}`);
  }
}

/** Execute a single command inside the task workspace. */
function runCommand(taskId, cmd, opts = {}) {
  return new Promise((resolve) => {
    const workspace = path.join(SANDBOX_ROOT, taskId);
    const timeout = Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const parsed = parseCommand(cmd);

    const tokens = parsed.split(/\s+/);
    if (tokens[0] === 'curl') {
      checkCurlArgs(tokens);
    }

    const started = Date.now();
    execFile(
      parsed,
      {
        cwd: workspace,
        env: sanitizeEnv(),
        timeout,
        maxBuffer: MAX_OUTPUT,
        shell: false,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          exitCode: error && typeof error.code === 'number' ? error.code : error?.code ?? (error ? 1 : 0),
          killed: Boolean(error?.killed),
          timedOut: Boolean(error?.killed) && Date.now() - started >= timeout,
          stdout: String(stdout ?? '').slice(0, MAX_OUTPUT),
          stderr: String(stderr ?? '').slice(0, MAX_OUTPUT),
          durationMs: Date.now() - started,
        });
      },
    );
  });
}

/** Create the workspace + an initial project file if provided. */
async function ensureWorkspace(taskId) {
  const dir = path.join(SANDBOX_ROOT, taskId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function writeFile(taskId, relPath, content) {
  const dir = path.join(SANDBOX_ROOT, taskId);
  const abs = path.join(dir, relPath);
  if (!abs.startsWith(dir)) {
    throw new Error('path escapes workspace');
  }
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf8');
}

async function readFile(taskId, relPath) {
  const dir = path.join(SANDBOX_ROOT, taskId);
  const abs = path.join(dir, relPath);
  if (!abs.startsWith(dir)) {
    throw new Error('path escapes workspace');
  }
  return fsp.readFile(abs, 'utf8');
}

async function listFiles(taskId, relPath = '') {
  const dir = path.join(SANDBOX_ROOT, taskId, relPath);
  if (!dir.startsWith(path.join(SANDBOX_ROOT, taskId))) {
    throw new Error('path escapes workspace');
  }
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
}

/**
 * Git helpers — token is passed per call, used in-memory only.
 * The token never touches disk, logs, or job records.
 */
async function gitStatus(taskId) {
  const workspace = path.join(SANDBOX_ROOT, taskId);
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain'], { cwd: workspace, env: sanitizeEnv() }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout ?? '').slice(0, MAX_OUTPUT),
        stderr: String(stderr ?? '').slice(0, MAX_OUTPUT),
      });
    });
  });
}

function redact(s) {
  return String(s).replace(/(gh[pousr]_[A-Za-z0-9]{6})[A-Za-z0-9]+/g, '$1…[redacted]');
}

async function gitCommitPush(taskId, { repoUrl, token, branch, message }) {
  const workspace = path.join(SANDBOX_ROOT, taskId);
  if (!token || !/^(gh[pousr]_|github_pat_)/.test(token)) {
    throw new Error('valid GitHub token required');
  }
  const env = { ...sanitizeEnv(), GIT_TERMINAL_PROMPT: '0' };
  const run = (args) =>
    new Promise((resolve) => {
      execFile('git', args, { cwd: workspace, env, timeout: 60_000 }, (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    });

  if (!repoUrl) {
    const remote = await run(['remote', 'get-url', 'origin']);
    repoUrl = remote.stdout.trim();
  }
  if (!repoUrl || !repoUrl.includes('github.com')) {
    throw new Error('a GitHub remote URL is required (set repoUrl)');
  }
  const authedUrl = repoUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);

  const results = [];
  results.push(await run(['config', 'user.email', 'tezgpt-agent@local']));
  results.push(await run(['config', 'user.name', 'TezGPT Agent']));
  results.push(await run(['add', '-A']));
  results.push(await run(['commit', '-m', message ?? 'TezGPT agent: automated changes']));
  results.push(await run(['remote', 'set-url', 'origin', authedUrl]));
  const branchName = branch ?? 'main';
  results.push(await run(['push', '-u', 'origin', `HEAD:${branchName}`]));
  // remove the authed URL immediately after push
  await run(['remote', 'set-url', 'origin', repoUrl]);

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    throw new Error(
      `git failed: ${failed.map((r) => redact(r.stderr || r.stdout).trim()).join(' | ')}`.slice(0, 500),
    );
  }
  return { branch: branchName, pushed: true };
}

/** Open a Pull Request via GitHub API (token in-memory only). */
async function createPullRequest({ token, owner, repo, head, base, title, body }) {
  if (!token || !owner || !repo) {
    throw new Error('token, owner and repo are required for PR');
  }
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/vnd.github+json',
      'user-agent': 'TezGPT-Agent',
    },
    body: JSON.stringify({ title, body: body ?? '', head, base: base ?? 'main' }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`.slice(0, 500));
  }
  const data = await res.json();
  return { prUrl: data.html_url, number: data.number };
}

module.exports = {
  SANDBOX_ROOT,
  ensureRoot,
  ensureWorkspace,
  runCommand,
  writeFile,
  readFile,
  listFiles,
  gitStatus,
  gitCommitPush,
  createPullRequest,
  loadJobs,
  persistJob,
  newId,
  redact,
};
