/**
 * TezGPT — Agent Mode loop (client-driven)
 *
 * The AI loop runs HERE, in the browser:
 *   - LLM decisions: made by the user's BYOK key via direct provider calls
 *     (keys never leave the browser)
 *   - terminal/file/git execution: delegated to the user's own server
 *     sandbox API (/api/tezgpt-agent/*) with a local handshake token
 *   - every step is checkpointed into the local memory store (IndexedDB),
 *     so the task can resume exactly where it stopped
 *
 * Pending rule: if a tool/key is missing (e.g. no GitHub token), that part
 * is marked "pending: needs X" and everything else continues.
 */

import { getSecret, type SecretKind } from './vault';
import { providerForKey, streamChat, buildSystemPrompt } from './provider';
import type { ChatMessage, SecretProvider } from './provider';
import {
  newId,
  saveAgentTask,
  appendAgentStep,
  setAgentCheckpoint,
  setAgentStatus,
  getAgentTask,
  type AgentTaskRecord,
  type AgentStep,
  type AgentTaskStatus,
} from './memory';

export const MAX_AGENT_STEPS = 30;
export const MAX_FIX_ATTEMPTS = 5;

let handshakeToken: string | null = null;
let handshakePromise: Promise<string> | null = null;

/** Fetch (once) the local sandbox handshake token from the user's own server. */
export async function getHandshakeToken(): Promise<string> {
  if (handshakeToken) {
    return handshakeToken;
  }
  if (!handshakePromise) {
    handshakePromise = fetch('/api/tezgpt-agent/handshake')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`handshake ${r.status}`))))
      .then((d) => {
        handshakeToken = d.token;
        try {
          sessionStorage.setItem('tezgpt-agent-token', d.token);
        } catch {
          /* ignore */
        }
        return d.token;
      });
  }
  return handshakePromise;
}

function cachedToken(): string | null {
  if (handshakeToken) {
    return handshakeToken;
  }
  try {
    handshakeToken = sessionStorage.getItem('tezgpt-agent-token');
  } catch {
    /* ignore */
  }
  return handshakeToken;
}

async function sandboxFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = cachedToken() ?? (await getHandshakeToken());
  return fetch(`/api/tezgpt-agent${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-tezgpt-agent-token': token,
      ...(init?.headers ?? {}),
    },
  });
}

export interface AgentAction {
  action: 'write' | 'run' | 'test' | 'git-push' | 'pr' | 'image' | 'pending' | 'done';
  path?: string;
  content?: string;
  command?: string;
  repo?: string;
  branch?: string;
  message?: string;
  summary?: string;
  reason?: string;
  title?: string;
  body?: string;
}

const AGENT_PROTOCOL = `You are the TezGPT coding agent working in a sandbox.
Reply with EXACTLY ONE JSON object (no markdown fences) describing your next action:
{"action":"write","path":"relative/path","content":"full file content"}
{"action":"run","command":"npm test"}          (allowed: node, npm, npx, python3, pip, git, curl, and basic utils)
{"action":"test","command":"npm test"}         (verifies the task; failures will be sent back to you to fix)
{"action":"git-push","repo":"https://github.com/owner/repo.git","branch":"main","message":"commit msg"}
{"action":"pr","repo":"https://github.com/owner/repo","branch":"main","title":"PR title","body":"PR body"}
{"action":"pending","reason":"needs X key"}
{"action":"done","summary":"what was accomplished"}
Rules:
- Break the task into small steps. Write files first, then run, then test.
- When a test fails, read the error, fix the code, and test again — keep fixing until it passes (max 5 attempts, then report).
- Never output secrets. Never invent commands outside the allowlist.`;

function parseAction(raw: string): AgentAction | null {
  const cleaned = raw.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const fenced = cleaned.match(/\{[\s\S]*\}/);
  if (!fenced) {
    return null;
  }
  try {
    const parsed = JSON.parse(fenced[0]);
    if (parsed && typeof parsed.action === 'string') {
      return parsed as AgentAction;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export interface AgentRunOptions {
  prompt: string;
  model?: string;
  taskId?: string;
  onUpdate?: (task: AgentTaskRecord) => void;
  signal?: AbortSignal;
}

async function llmCall(
  provider: SecretProvider,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const system = [buildSystemPrompt(), AGENT_PROTOCOL].join('\n\n');
  let out = '';
  await streamChat({
    provider,
    apiKey,
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    temperature: 0.2,
    maxTokens: 8000,
    signal,
    onDelta: (t) => {
      out += t;
    },
  });
  return out;
}

function needsKeyMessage(what: string): string {
  return `pending: needs ${what}`;
}

/**
 * Run the agent loop to completion. Saves/updates the task record on every
 * step so the UI (and a resumed session) always has the latest state.
 */
export async function runAgentTask(opts: AgentRunOptions): Promise<AgentTaskRecord> {
  const aiKey = await getSecret('aiKey');
  const ghToken = await getSecret('githubToken');
  const imageKey = await getSecret('imageKey');

  const taskId = opts.taskId ?? newId('task');
  const existing = await getAgentTask(taskId);
  const task: AgentTaskRecord = existing ?? {
    id: taskId,
    prompt: opts.prompt,
    status: 'running',
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  task.status = 'running';
  await saveAgentTask(task);

  const push = async (step: Omit<AgentStep, 'id' | 'at'>) => {
    await appendAgentStep(taskId, { ...step, id: newId('step') } as AgentStep);
    const fresh = await getAgentTask(taskId);
    if (fresh) {
      opts.onUpdate?.(fresh);
    }
  };

  const pending: string[] = [];
  const finish = async (status: AgentTaskStatus, result?: string) => {
    task.status = status;
    await setAgentStatus(taskId, status, result);
    if (pending.length) {
      const t = await getAgentTask(taskId);
      if (t) {
        t.pendingReasons = pending;
        await saveAgentTask(t);
      }
    }
    const fresh = await getAgentTask(taskId);
    opts.onUpdate?.(fresh ?? task);
    return fresh ?? task;
  };

  try {
    if (!aiKey) {
      await push({
        kind: 'error',
        text: needsKeyMessage('AI API Key — add it in Settings → BYOK Keys'),
      });
      return finish('pending', 'No AI key configured.');
    }

    // server-side job record (status mirror for the queue view)
    try {
      await sandboxFetch('/jobs', {
        method: 'POST',
        body: JSON.stringify({ prompt: opts.prompt, meta: { clientTaskId: taskId } }),
      });
    } catch {
      await push({ kind: 'info', text: 'sandbox server unavailable — running without terminal' });
    }

    const provider = providerForKey(aiKey);
    const model = opts.model ?? '';
    const messages: ChatMessage[] = [{ role: 'user', content: `TASK: ${opts.prompt}` }];

    await push({ kind: 'plan', text: `Agent started (${provider}${model ? ` · ${model}` : ''})` });
    await setAgentCheckpoint(taskId, task.steps.length, JSON.stringify({ phase: 'start' }));

    let fixAttempts = 0;
    let parseFailures = 0;

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      if (opts.signal?.aborted) {
        await setAgentStatus(taskId, 'paused', 'Paused by user — resume anytime.');
        await push({ kind: 'info', text: 'paused by user' });
        return finish('paused', 'Paused by user');
      }

      await push({ kind: 'info', text: `thinking… (step ${step + 1}/${MAX_AGENT_STEPS})` });

      let raw: string;
      try {
        raw = await llmCall(provider, aiKey, model, messages, opts.signal);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await push({ kind: 'error', text: `LLM error: ${msg.slice(0, 300)}` });
        return finish('failed', msg);
      }

      const action = parseAction(raw);
      if (!action) {
        parseFailures += 1;
        await push({ kind: 'info', text: `(non-JSON reply) ${raw.slice(0, 240)}` });
        messages.push({ role: 'assistant', content: raw });
        messages.push({
          role: 'user',
          content: 'Reply with exactly one JSON action object as instructed.',
        });
        if (parseFailures >= 4) {
          return finish('failed', 'Model did not follow the agent protocol (JSON actions).');
        }
        continue;
      }
      parseFailures = 0;
      messages.push({ role: 'assistant', content: raw });

      switch (action.action) {
        case 'write': {
          if (!action.path || typeof action.content !== 'string') {
            messages.push({ role: 'user', content: 'write action needs path and content' });
            break;
          }
          await push({ kind: 'write', text: `writing ${action.path}`, file: action.path });
          try {
            const res = await sandboxFetch('/files/write', {
              method: 'POST',
              body: JSON.stringify({ taskId, path: action.path, content: action.content }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data.message ?? `write failed ${res.status}`);
            }
            messages.push({
              role: 'user',
              content: `[system] wrote ${action.path} (${data.bytes ?? '?'} bytes)`,
            });
            await setAgentCheckpoint(taskId, task.steps.length, JSON.stringify({ last: action.path }));
          } catch (e) {
            await push({ kind: 'error', text: `write failed: ${(e as Error).message.slice(0, 200)}` });
            messages.push({
              role: 'user',
              content: `[system] write failed: ${(e as Error).message}. Try a different path or action.`,
            });
          }
          break;
        }
        case 'run':
        case 'test': {
          if (!action.command) {
            messages.push({ role: 'user', content: `${action.action} action needs a command` });
            break;
          }
          const isTest = action.action === 'test';
          await push({ kind: isTest ? 'test' : 'run', text: `$ ${action.command}` });
          try {
            const res = await sandboxFetch('/exec', {
              method: 'POST',
              body: JSON.stringify({ taskId, command: action.command, timeoutMs: 180000 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok && !('stdout' in data) && !('stderr' in data)) {
              throw new Error(data.message ?? `exec failed ${res.status}`);
            }
            const out = ((data.stdout || '') || (data.stderr || '')).slice(0, 3000);
            if (isTest) {
              if (data.ok) {
                fixAttempts = 0;
                messages.push({ role: 'user', content: `[system] test PASSED\n${out}` });
                await push({ kind: 'test', text: '✓ test passed', ok: true });
              } else {
                fixAttempts += 1;
                messages.push({
                  role: 'user',
                  content: `[system] test FAILED (attempt ${fixAttempts}/${MAX_FIX_ATTEMPTS}). Fix the code and test again.\n${out}`,
                });
                if (fixAttempts >= MAX_FIX_ATTEMPTS) {
                  await push({ kind: 'error', text: `test still failing after ${fixAttempts} attempts` });
                  return finish('failed', `Tests failing after ${fixAttempts} attempts.`);
                }
              }
            } else {
              messages.push({ role: 'user', content: `[system] command output (ok=${data.ok}):\n${out}` });
            }
          } catch (e) {
            await push({ kind: 'error', text: `exec failed: ${(e as Error).message.slice(0, 200)}` });
            messages.push({
              role: 'user',
              content: `[system] command could not run: ${(e as Error).message.slice(0, 200)}`,
            });
          }
          break;
        }
        case 'git-push': {
          if (!ghToken) {
            pending.push('GitHub Token — Settings → BYOK Keys');
            await push({ kind: 'git', text: needsKeyMessage('GitHub Token'), ok: false });
            messages.push({
              role: 'user',
              content: '[system] no GitHub token configured. Skip git; continue other work.',
            });
            break;
          }
          await push({ kind: 'git', text: `committing & pushing to ${action.branch ?? 'main'}` });
          try {
            const res = await sandboxFetch('/git/push', {
              method: 'POST',
              body: JSON.stringify({
                taskId,
                repoUrl: action.repo,
                token: ghToken,
                branch: action.branch,
                message: action.message,
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data.message ?? `push failed ${res.status}`);
            }
            await push({ kind: 'git', text: `✓ pushed to ${data.branch ?? action.branch}`, ok: true });
            messages.push({
              role: 'user',
              content: `[system] pushed to branch ${data.branch ?? action.branch}. Continue with remaining tasks.`,
            });
          } catch (e) {
            await push({ kind: 'git', text: `push failed: ${(e as Error).message.slice(0, 250)}`, ok: false });
            pending.push(`git push failed: ${(e as Error).message.slice(0, 120)}`);
            messages.push({
              role: 'user',
              content: `[system] push failed: ${(e as Error).message.slice(0, 200)}. Continue without git.`,
            });
          }
          break;
        }
        case 'pr': {
          if (!ghToken) {
            pending.push('GitHub Token — Settings → BYOK Keys');
            await push({ kind: 'git', text: needsKeyMessage('GitHub Token'), ok: false });
            messages.push({ role: 'user', content: '[system] no GitHub token. Skip PR; continue.' });
            break;
          }
          try {
            const repo = action.repo ?? '';
            const m = repo.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
            if (!m) {
              throw new Error('PR needs a GitHub repo URL like https://github.com/owner/repo');
            }
            await push({ kind: 'git', text: `opening PR → ${m[1]}/${m[2]}` });
            const res = await sandboxFetch('/git/pr', {
              method: 'POST',
              body: JSON.stringify({
                token: ghToken,
                owner: m[1],
                repo: m[2],
                head: action.branch ?? 'main',
                base: 'main',
                title: action.title ?? 'TezGPT agent changes',
                body: action.body ?? '',
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data.message ?? `PR failed ${res.status}`);
            }
            await push({ kind: 'git', text: `✓ PR opened: ${data.prUrl}`, ok: true });
          } catch (e) {
            await push({ kind: 'git', text: `PR failed: ${(e as Error).message.slice(0, 250)}`, ok: false });
            pending.push(`PR: ${(e as Error).message.slice(0, 120)}`);
          }
          break;
        }
        case 'image': {
          if (!imageKey) {
            pending.push('Image-gen Key — Settings → BYOK Keys');
            await push({ kind: 'info', text: needsKeyMessage('Image-gen Key') });
            messages.push({ role: 'user', content: '[system] no image key. Mark as pending and continue.' });
            break;
          }
          await push({
            kind: 'info',
            text: 'image generation is delegated to the chat endpoint (image key present)',
          });
          messages.push({
            role: 'user',
            content:
              '[system] image generation should be requested via the chat UI where the image provider is wired. Continue.',
          });
          break;
        }
        case 'pending': {
          const reason = action.reason ?? 'unspecified';
          pending.push(reason);
          await push({ kind: 'info', text: `⏸ ${reason}` });
          messages.push({ role: 'user', content: `[system] noted pending: ${reason}. Continue everything else.` });
          break;
        }
        case 'done': {
          const summary = action.summary ?? 'Task completed.';
          await push({ kind: 'info', text: `✓ ${summary}`, ok: true });
          if (pending.length) {
            return finish('pending', summary);
          }
          return finish('passed', summary);
        }
        default: {
          messages.push({ role: 'user', content: `unknown action "${(action as { action: string }).action}"` });
        }
      }
      await setAgentCheckpoint(taskId, task.steps.length, JSON.stringify({ phase: `step-${step}` }));
    }

    return finish('failed', `Reached the ${MAX_AGENT_STEPS}-step limit.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await setAgentStatus(taskId, 'failed', msg);
    } catch {
      /* ignore */
    }
    return finish('failed', msg);
  }
}

/** Resume an interrupted/paused task from its checkpoint. */
export async function resumeAgentTask(taskId: string, opts?: { onUpdate?: (t: AgentTaskRecord) => void }) {
  const task = await getAgentTask(taskId);
  if (!task) {
    throw new Error('task not found');
  }
  return runAgentTask({
    prompt: task.prompt,
    taskId: task.id,
    onUpdate: opts?.onUpdate,
  });
}

export type { SecretKind };
