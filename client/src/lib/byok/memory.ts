/**
 * TezGPT — Continuous Memory (IndexedDB)
 *
 * Persistent, cross-session memory: conversations, agent tasks with
 * checkpoints, decisions, preferences and pending items. Works fully
 * offline in BYOK single-user mode (no server/MongoDB required).
 */

const DB_NAME = 'tezgpt-memory';
const DB_VERSION = 1;

export interface MemoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: MemoryMessage[];
  summary?: string;
}

export type AgentTaskStatus = 'queued' | 'running' | 'paused' | 'passed' | 'failed' | 'pending';

export interface AgentStep {
  id: string;
  kind: 'plan' | 'write' | 'run' | 'test' | 'fix' | 'git' | 'info' | 'error';
  text: string;
  file?: string;
  at: number;
}

export interface AgentCheckpoint {
  stepIndex: number;
  state: string; // JSON snapshot
  at: number;
}

export interface AgentTaskRecord {
  id: string;
  prompt: string;
  status: AgentTaskStatus;
  steps: AgentStep[];
  createdAt: number;
  updatedAt: number;
  checkpoint?: AgentCheckpoint;
  result?: string;
  pendingReasons?: string[];
}

export interface MemoryEntry {
  id: string;
  kind: 'summary' | 'decision' | 'preference' | 'pending' | 'fact';
  text: string;
  tags: string[];
  createdAt: number;
}

const STORES = ['conversations', 'agentTasks', 'memories'] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('memory db open failed'));
  });
  return dbPromise;
}

function idbPut(store: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('put failed'));
      }),
  );
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error ?? new Error('get failed'));
      }),
  );
}

function idbAll<T>(store: string): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as T[]);
        req.onerror = () => reject(req.error ?? new Error('getAll failed'));
      }),
  );
}

function idbDelete(store: string, key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('delete failed'));
      }),
  );
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/* ---------------- conversations ---------------- */

export async function saveConversation(convo: ConversationRecord): Promise<void> {
  convo.updatedAt = Date.now();
  await idbPut('conversations', convo);
}

export async function appendMessage(convoId: string, message: MemoryMessage): Promise<void> {
  const convo = await idbGet<ConversationRecord>('conversations', convoId);
  if (!convo) {
    return;
  }
  convo.messages.push(message);
  convo.updatedAt = Date.now();
  await idbPut('conversations', convo);
}

export async function listConversations(limit = 50): Promise<ConversationRecord[]> {
  const all = await idbAll<ConversationRecord>('conversations');
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export async function getConversation(id: string): Promise<ConversationRecord | null> {
  const c = await idbGet<ConversationRecord>('conversations', id);
  return c ?? null;
}

export async function deleteConversation(id: string): Promise<void> {
  await idbDelete('conversations', id);
}

/** Rebuild context for a resumed session (memory core requirement). */
export async function getResumeContext(): Promise<{
  lastConversation: ConversationRecord | null;
  ongoingAgentTask: AgentTaskRecord | null;
  recentMemories: MemoryEntry[];
}> {
  const convos = await listConversations(5);
  const tasks = await listAgentTasks();
  const ongoing = tasks.find((t) => t.status === 'running' || t.status === 'paused' || t.status === 'queued') ?? null;
  const memories = await listMemories(10);
  return { lastConversation: convos[0] ?? null, ongoingAgentTask: ongoing, recentMemories: memories };
}

/* ---------------- agent tasks ---------------- */

export async function saveAgentTask(task: AgentTaskRecord): Promise<void> {
  task.updatedAt = Date.now();
  await idbPut('agentTasks', task);
}

export async function getAgentTask(id: string): Promise<AgentTaskRecord | null> {
  const t = await idbGet<AgentTaskRecord>('agentTasks', id);
  return t ?? null;
}

export async function listAgentTasks(limit = 50): Promise<AgentTaskRecord[]> {
  const all = await idbAll<AgentTaskRecord>('agentTasks');
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export async function appendAgentStep(taskId: string, step: AgentStep): Promise<void> {
  const task = await idbGet<AgentTaskRecord>('agentTasks', taskId);
  if (!task) {
    return;
  }
  task.steps.push(step);
  task.updatedAt = Date.now();
  await idbPut('agentTasks', task);
}

export async function setAgentCheckpoint(taskId: string, stepIndex: number, state: string): Promise<void> {
  const task = await idbGet<AgentTaskRecord>('agentTasks', taskId);
  if (!task) {
    return;
  }
  task.checkpoint = { stepIndex, state, at: Date.now() };
  task.updatedAt = Date.now();
  await idbPut('agentTasks', task);
}

export async function setAgentStatus(taskId: string, status: AgentTaskStatus, result?: string): Promise<void> {
  const task = await idbGet<AgentTaskRecord>('agentTasks', taskId);
  if (!task) {
    return;
  }
  task.status = status;
  if (result !== undefined) {
    task.result = result;
  }
  task.updatedAt = Date.now();
  await idbPut('agentTasks', task);
}

export async function deleteAgentTask(id: string): Promise<void> {
  await idbDelete('agentTasks', id);
}

/* ---------------- memories (facts/decisions/preferences) ---------------- */

export async function addMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
  const full: MemoryEntry = { ...entry, id: newId('mem'), createdAt: Date.now() };
  await idbPut('memories', full);
  return full;
}

export async function listMemories(limit = 50): Promise<MemoryEntry[]> {
  const all = await idbAll<MemoryEntry>('memories');
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function searchMemories(query: string, limit = 10): Promise<MemoryEntry[]> {
  const q = query.toLowerCase();
  const all = await idbAll<MemoryEntry>('memories');
  return all
    .filter((m) => m.text.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function deleteMemory(id: string): Promise<void> {
  await idbDelete('memories', id);
}
