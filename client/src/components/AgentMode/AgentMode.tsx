/**
 * TezGPT — Agent Mode
 * Naya mode/tab: task prompt → live "building" panel (real-time steps) →
 * background-style task queue (local memory) → resume anytime.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Play,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  GitBranch,
  ImageIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Clock,
  FileCode2,
  TerminalSquare,
} from 'lucide-react';
import {
  runAgentTask,
  resumeAgentTask,
  MAX_AGENT_STEPS,
} from '~/lib/byok/agentLoop';
import {
  listAgentTasks,
  deleteAgentTask,
  type AgentTaskRecord,
  type AgentStep,
} from '~/lib/byok/memory';
import { listSecretMeta } from '~/lib/byok/vault';

const STATUS_BADGE: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  running: { label: 'running', cls: 'bg-blue-500/15 text-blue-500', icon: <Loader2 size={12} className="animate-spin" /> },
  passed: { label: 'passed', cls: 'bg-green-500/15 text-green-500', icon: <CheckCircle2 size={12} /> },
  failed: { label: 'failed', cls: 'bg-red-500/15 text-red-500', icon: <XCircle size={12} /> },
  paused: { label: 'paused', cls: 'bg-amber-500/15 text-amber-500', icon: <PauseCircle size={12} /> },
  pending: { label: 'pending items', cls: 'bg-purple-500/15 text-purple-500', icon: <Clock size={12} /> },
  queued: { label: 'queued', cls: 'bg-gray-500/15 text-gray-500', icon: <Clock size={12} /> },
};

function StepIcon({ kind }: { kind: AgentStep['kind'] }) {
  switch (kind) {
    case 'write':
      return <FileCode2 size={13} className="mt-0.5 shrink-0 text-amber-500" />;
    case 'run':
    case 'test':
      return <TerminalSquare size={13} className="mt-0.5 shrink-0 text-sky-500" />;
    case 'git':
      return <GitBranch size={13} className="mt-0.5 shrink-0 text-pink-500" />;
    case 'error':
      return <XCircle size={13} className="mt-0.5 shrink-0 text-red-500" />;
    case 'plan':
      return <Bot size={13} className="mt-0.5 shrink-0 text-purple-400" />;
    default:
      return <span className="mt-0.5 shrink-0 text-gray-400">•</span>;
  }
}

/** Live building panel — real-time progress log with expand/collapse. */
function BuildingPanel({ task, expanded, onToggle }: { task: AgentTaskRecord; expanded: boolean; onToggle: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [task.steps.length, expanded]);

  const running = task.status === 'running';
  const last = task.steps[task.steps.length - 1];

  return (
    <div className="overflow-hidden rounded-xl border border-border-light bg-surface-secondary">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          {running ? (
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-primary opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-accent-primary" />
            </span>
          ) : (
            <span className="flex h-3 w-3 shrink-0 items-center justify-center">
              {STATUS_BADGE[task.status]?.icon}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">
              {running ? (last?.text ?? 'building…') : `Status: ${STATUS_BADGE[task.status]?.label ?? task.status}`}
            </p>
            <p className="text-xs text-text-tertiary">
              {task.steps.length} steps · {new Date(task.updatedAt).toLocaleTimeString()}
            </p>
          </div>
        </div>
        {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {expanded && (
        <div ref={scrollRef} className="max-h-72 space-y-1.5 overflow-y-auto border-t border-border-light px-4 py-3 font-mono text-xs">
          {task.steps.map((s) => (
            <div key={s.id} className="flex items-start gap-2">
              <StepIcon kind={s.kind} />
              <div className="min-w-0">
                <span className="text-text-primary">{s.text}</span>
                {s.detail ? (
                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-black/5 px-2 py-1 text-[11px] text-text-tertiary dark:bg-white/5">
                    {s.detail}
                  </pre>
                ) : null}
                <span className="ml-2 text-[10px] text-text-tertiary">
                  {new Date(s.at).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 text-text-tertiary">
              <Loader2 size={12} className="animate-spin" /> working…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentMode() {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([]);
  const [activeTask, setActiveTask] = useState<AgentTaskRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [keys, setKeys] = useState<{ aiKey: boolean; githubToken: boolean; imageKey: boolean }>({
    aiKey: false,
    githubToken: false,
    imageKey: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const [taskList, metas] = await Promise.all([listAgentTasks(20), listSecretMeta()]);
    setTasks(taskList);
    setKeys({
      aiKey: metas.some((m) => m.kind === 'aiKey'),
      githubToken: metas.some((m) => m.kind === 'githubToken'),
      imageKey: metas.some((m) => m.kind === 'imageKey'),
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const start = useCallback(async () => {
    if (!prompt.trim()) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    await runAgentTask({
      prompt: prompt.trim(),
      model: model.trim() || undefined,
      signal: controller.signal,
      onUpdate: (t) => {
        setActiveTask(t);
        setExpandedId(t.id);
        setTasks((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);
      },
    });
    setPrompt('');
    await refresh();
  }, [prompt, model, refresh]);

  const resume = useCallback(
    async (task: AgentTaskRecord) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setExpandedId(task.id);
      await resumeAgentTask(task.id, {
        onUpdate: (t) => {
          setActiveTask(t);
          setTasks((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);
        },
      });
      await refresh();
    },
    [refresh],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const removeTask = useCallback(
    async (id: string) => {
      await deleteAgentTask(id);
      await refresh();
    },
    [refresh],
  );

  const keyChips = useMemo(
    () => [
      { ok: keys.aiKey, label: 'AI Key', icon: <KeyRound size={11} /> },
      { ok: keys.githubToken, label: 'GitHub', icon: <GitBranch size={11} /> },
      { ok: keys.imageKey, label: 'Image', icon: <ImageIcon size={11} /> },
    ],
    [keys],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            to="/c/new"
            className="rounded-lg border border-border-light p-2 text-text-secondary hover:bg-surface-hover"
            aria-label="back to chat"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-bold text-text-primary">
            <Bot size={18} className="text-accent-primary" /> Agent Mode
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          {keyChips.map((c) => (
            <span
              key={c.label}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                c.ok ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/10 text-text-tertiary'
              }`}
              title={c.ok ? 'configured' : 'not configured — go to Settings → BYOK Keys'}
            >
              {c.icon}
              {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* task input */}
      <div className="rounded-xl border border-border-light bg-surface-secondary p-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Agent ko task do… e.g. 'Python mein ek number-guessing game banao, tests likho, tests pass hone ke baad GitHub pe push karo (repo URL: …)'"
          className="w-full resize-none rounded-lg border border-border-medium bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-primary"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model (optional, e.g. claude-sonnet-4-6 / gpt-4o-mini)"
            className="min-w-0 flex-1 rounded-lg border border-border-medium bg-surface-primary px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-primary"
          />
          <button
            type="button"
            onClick={start}
            disabled={!prompt.trim()}
            className="flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-semibold text-white hover:bg-accent-primary-hover disabled:opacity-40"
          >
            <Play size={14} /> Run task
          </button>
          {activeTask?.status === 'running' && (
            <button
              type="button"
              onClick={cancel}
              className="flex items-center gap-2 rounded-lg border border-border-medium px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover"
            >
              <PauseCircle size={14} /> Pause
            </button>
          )}
        </div>
        {!keys.aiKey && (
          <p className="mt-2 text-xs text-amber-500">
            ⚠ No AI key configured — agent tasks need one. Settings → BYOK Keys mein add karo (silently auto-save bhi ho
            jayega agar chat mein paste karoge).
          </p>
        )}
      </div>

      {/* live building panel */}
      {activeTask && <BuildingPanel task={activeTask} expanded={expandedId === activeTask.id} onToggle={() => setExpandedId((id) => (id === activeTask.id ? null : activeTask.id))} />}

      {activeTask?.pendingReasons && activeTask.pendingReasons.length > 0 && (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3 text-sm text-text-primary">
          <p className="font-semibold">Pending list (baaki sab complete):</p>
          <ul className="mt-1 list-inside list-disc text-text-secondary">
            {activeTask.pendingReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* task queue / history */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-text-secondary">
          Task queue & history ({tasks.length}) — background tasks yahan chalti rahengi aur baad mein bhi dikhengi
        </h2>
        {tasks.length === 0 && (
          <p className="rounded-xl border border-dashed border-border-medium p-4 text-center text-xs text-text-tertiary">
            Abhi koi task nahi. Upar prompt likhkar Run karo — agent code likhega, test karega, fix karega, aur history
            yahan save hoti rahegi (even app band karne ke baad).
          </p>
        )}
        {tasks.map((t) => {
          const badge = STATUS_BADGE[t.status] ?? STATUS_BADGE.queued;
          return (
            <div key={t.id} className="rounded-xl border border-border-light bg-surface-secondary px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">{t.prompt}</p>
                  <p className="mt-0.5 text-[11px] text-text-tertiary">
                    {new Date(t.createdAt).toLocaleString()} · {t.steps.length} steps
                    {t.checkpoint ? ' · checkpoint saved' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                    {badge.icon}
                    {badge.label}
                  </span>
                  {(t.status === 'paused' || t.status === 'failed' || t.status === 'pending') && (
                    <button
                      type="button"
                      onClick={() => resume(t)}
                      className="flex items-center gap-1 rounded-lg border border-border-medium px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-hover"
                      title="resume from checkpoint"
                    >
                      <RotateCcw size={12} /> Resume
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeTask(t.id)}
                    className="rounded-lg border border-border-medium p-1.5 text-text-tertiary hover:bg-surface-hover"
                    aria-label="delete task"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {expandedId === t.id && t.id !== activeTask?.id && (
                <BuildingPanel task={t} expanded onToggle={() => setExpandedId(null)} />
              )}
              {expandedId !== t.id && t.id !== activeTask?.id && t.steps.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedId(t.id)}
                  className="mt-2 text-xs font-medium text-accent-primary hover:underline"
                >
                  Show {t.steps.length} steps
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
