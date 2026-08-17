/**
 * TezGPT — Agent Mode sandbox routes
 *
 * Single-user BYOK design:
 *  - handshake issues an ephemeral local token (CORS prevents foreign
 *    origins from reading it), required for all mutations.
 *  - jobs persist to a local JSONL file (works without MongoDB).
 *  - the AI loop is driven by the CLIENT (browser) so user keys never
 *    touch this server; the server only executes allowed commands.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fsp = require('fs').promises;
const fs = require('fs');
const sandbox = require('~/server/services/agent/sandboxExecutor');

const localToken = crypto.randomBytes(24).toString('hex');
const activeJobs = new Map(); // id -> job state (live)
let jobsLoaded = false;

async function getJobStore() {
  if (!jobsLoaded) {
    const persisted = await sandbox.loadJobs();
    for (const [id, job] of persisted) {
      if (!activeJobs.has(id)) {
        activeJobs.set(id, job);
      }
    }
    jobsLoaded = true;
  }
  return activeJobs;
}

function authLocal(req, res, next) {
  const token = req.get('x-tezgpt-agent-token');
  if (!token || token !== localToken) {
    return res.status(401).json({ message: 'invalid local agent token' });
  }
  next();
}

function sanitizeJob(job) {
  // never echo secrets back (in case a client bug ever put one in)
  const clean = { ...job };
  delete clean.secrets;
  return clean;
}

/** Creates a job record; the browser keeps its own copy too (memory store). */
async function createJob(prompt, meta = {}) {
  const store = await getJobStore();
  const job = {
    id: sandbox.newId(),
    prompt: String(prompt ?? '').slice(0, 8000),
    status: 'running',
    steps: [],
    files: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    meta,
  };
  store.set(job.id, job);
  await sandbox.persistJob(job);
  await sandbox.ensureWorkspace(job.id);
  return job;
}

function addStep(job, step) {
  job.steps.push({ at: Date.now(), ...step });
  job.updatedAt = Date.now();
  if (job.steps.length > 500) {
    job.steps = job.steps.slice(-500);
  }
}

async function updateJob(job) {
  job.updatedAt = Date.now();
  await sandbox.persistJob(job);
}

// ---- handshake ----
router.get('/handshake', (_req, res) => {
  res.json({ token: localToken, capabilities: { terminal: true, git: true, files: true } });
});

// ---- job endpoints ----
router.get('/jobs', authLocal, async (_req, res) => {
  const store = await getJobStore();
  const jobs = [...store.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(sanitizeJob);
  res.json(jobs);
});

router.get('/jobs/:id', authLocal, async (req, res) => {
  const store = await getJobStore();
  const job = store.get(req.params.id);
  if (!job) {
    return res.status(404).json({ message: 'job not found' });
  }
  res.json(sanitizeJob(job));
});

router.post('/jobs', authLocal, async (req, res) => {
  const { prompt, meta } = req.body ?? {};
  const job = await createJob(prompt, meta);
  res.status(201).json(sanitizeJob(job));
});

router.patch('/jobs/:id', authLocal, async (req, res) => {
  const store = await getJobStore();
  const job = store.get(req.params.id);
  if (!job) {
    return res.status(404).json({ message: 'job not found' });
  }
  const { status, result, pendingReasons, step } = req.body ?? {};
  if (status) {
    job.status = status;
  }
  if (result !== undefined) {
    job.result = String(result).slice(0, 20000);
  }
  if (Array.isArray(pendingReasons)) {
    job.pendingReasons = pendingReasons;
  }
  if (step) {
    addStep(job, step);
  }
  await updateJob(job);
  res.json(sanitizeJob(job));
});

router.delete('/jobs/:id', authLocal, async (req, res) => {
  const store = await getJobStore();
  if (!store.has(req.params.id)) {
    return res.status(404).json({ message: 'job not found' });
  }
  store.delete(req.params.id);
  const dir = path.join(sandbox.SANDBOX_ROOT, req.params.id);
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  res.json({ deleted: true });
});

// ---- sandbox ops ----
router.post('/exec', authLocal, async (req, res) => {
  const { taskId, command, timeoutMs } = req.body ?? {};
  if (!taskId || typeof command !== 'string') {
    return res.status(400).json({ message: 'taskId and command are required' });
  }
  const store = await getJobStore();
  const job = store.get(taskId);
  if (!job) {
    return res.status(404).json({ message: 'job not found' });
  }
  try {
    const result = await sandbox.runCommand(taskId, command, { timeoutMs });
    addStep(job, {
      kind: 'run',
      text: `$ ${String(command).slice(0, 300)}`,
      detail: result.ok
        ? (result.stdout || '').slice(0, 4000)
        : (result.stderr || result.stdout || '').slice(0, 4000),
      ok: result.ok,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    });
    await updateJob(job);
    res.json(result);
  } catch (e) {
    addStep(job, { kind: 'error', text: `sandbox: ${e.message}` });
    await updateJob(job);
    res.status(400).json({ message: e.message });
  }
});

router.post('/files/write', authLocal, async (req, res) => {
  const { taskId, path: relPath, content } = req.body ?? {};
  if (!taskId || !relPath || typeof content !== 'string') {
    return res.status(400).json({ message: 'taskId, path and content are required' });
  }
  try {
    await sandbox.writeFile(taskId, relPath, content);
    const store = await getJobStore();
    const job = store.get(taskId);
    if (job && !job.files.includes(relPath)) {
      job.files.push(relPath);
      await updateJob(job);
    }
    res.json({ written: relPath, bytes: Buffer.byteLength(content) });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.get('/files', authLocal, async (req, res) => {
  const { taskId } = req.query;
  if (!taskId) {
    return res.status(400).json({ message: 'taskId is required' });
  }
  try {
    const files = await sandbox.listFiles(String(taskId), req.query.path ? String(req.query.path) : '');
    res.json(files);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.get('/files/read', authLocal, async (req, res) => {
  const { taskId, path: relPath } = req.query;
  if (!taskId || !relPath) {
    return res.status(400).json({ message: 'taskId and path are required' });
  }
  try {
    const content = await sandbox.readFile(String(taskId), String(relPath));
    res.json({ path: relPath, content });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ---- git (token in-memory only, never persisted) ----
router.post('/git/status', authLocal, async (req, res) => {
  const { taskId } = req.body ?? {};
  if (!taskId) {
    return res.status(400).json({ message: 'taskId is required' });
  }
  const out = await sandbox.gitStatus(taskId);
  res.json(out);
});

router.post('/git/push', authLocal, async (req, res) => {
  const { taskId, repoUrl, token, branch, message } = req.body ?? {};
  if (!taskId) {
    return res.status(400).json({ message: 'taskId is required' });
  }
  const store = await getJobStore();
  const job = store.get(taskId);
  try {
    const result = await sandbox.gitCommitPush(taskId, { repoUrl, token, branch, message });
    if (job) {
      addStep(job, { kind: 'git', text: `pushed to ${result.branch}`, ok: true });
      await updateJob(job);
    }
    res.json(result);
  } catch (e) {
    if (job) {
      addStep(job, { kind: 'git', text: sandbox.redact(e.message), ok: false });
      await updateJob(job);
    }
    res.status(400).json({ message: sandbox.redact(e.message) });
  }
});

router.post('/git/pr', authLocal, async (req, res) => {
  const { token, owner, repo, head, base, title, body } = req.body ?? {};
  try {
    const result = await sandbox.createPullRequest({ token, owner, repo, head, base, title, body });
    res.json(result);
  } catch (e) {
    res.status(400).json({ message: sandbox.redact(e.message) });
  }
});

module.exports = router;
