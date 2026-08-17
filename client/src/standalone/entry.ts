/**
 * TezGPT — Vanilla Standalone Engine (APK / no-server mode)
 *
 * Ye entry APK build mein React app ki JAGAH load hota hai
 * (VITE_STANDALONE=true). Sirf plain TypeScript + DOM — koi router,
 * koi i18n, koi heavy dependency nahi. Crashing ka koi surface nahi.
 *
 * Features:
 *  - Chat: BYOK direct provider streaming (OpenRouter/Anthropic/Google/…)
 *  - Keys: encrypted local vault (AES-GCM IndexedDB)
 *  - Secret paste guard: chat mein key paste → Keys mein save, AI ko kabhi nahi
 *  - History: conversations IndexedDB mein (cross-session resume)
 *  - Agent: local task loop (planning/code-gen); terminal ke liye server
 *    chahiye — app honestly bata deta hai, pending-rule lagti hai
 */

import './vanilla.css';
import {
  getSecret,
  saveSecret,
  deleteSecret,
  getSecretMeta,
  type SecretKind,
} from '~/lib/byok/vault';
import { providerForKey, streamChat, buildSystemPrompt } from '~/lib/byok/provider';
import { detectSecrets, detectProviderFromKey } from '~/lib/byok/detector';
import {
  listConversations,
  saveConversation,
  deleteConversation,
  newId,
  getResumeContext,
  type ConversationRecord,
  type MemoryMessage,
} from '~/lib/byok/memory';
import { runAgentTask, resumeAgentTask } from '~/lib/byok/agentLoop';
import type { AgentTaskRecord } from '~/lib/byok/memory';

/* ------------------------------------------------------------------ */
/* tiny DOM helpers                                                    */
/* ------------------------------------------------------------------ */

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) {
    el.className = cls;
  }
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

function toast(msg: string): void {
  let t = document.getElementById('tg-toast') as HTMLDivElement | null;
  if (!t) {
    t = h('div', 'tg-toast') as HTMLDivElement;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  window.setTimeout(() => t?.classList.remove('show'), 2800);
}

const app = document.getElementById('root');
if (!app) {
  throw new Error('root not found');
}
app.innerHTML = '';
app.classList.add('tg-root');

type Tab = 'chat' | 'keys' | 'agent';

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

let tab: Tab = 'chat';
let convo: ConversationRecord | null = null;
let convos: ConversationRecord[] = [];
let streaming = false;
let abort: AbortController | null = null;
let hasKey: boolean | null = null;

/* ------------------------------------------------------------------ */
/* Render skeleton                                                    */
/* ------------------------------------------------------------------ */

const header = h('header', 'tg-header');
const tabsRow = h('nav', 'tg-tabs');
const main = h('main', 'tg-main');
const footer = h('footer', 'tg-footer');

function chip(text: string, ok: boolean, id: string): HTMLElement {
  const c = h('span', `tg-chip ${ok ? 'ok' : 'warn'}`, text);
  c.id = id;
  return c;
}

function buildSkeleton(): void {
  app.innerHTML = '';

  const brand = h('div', 'tg-brand');
  brand.appendChild(h('span', 'tg-logo', '⚡'));
  const nameBox = h('div', 'tg-brand-text');
  nameBox.appendChild(h('div', 'tg-brand-name', 'TezGPT'));
  nameBox.appendChild(h('div', 'tg-brand-sub', 'v3 · LOCAL MODE — server ki zaroorat nahi'));
  brand.appendChild(nameBox);
  header.appendChild(brand);
  header.appendChild(chip('key: …', false, 'tg-keychip'));

  const defs: { id: Tab; label: string }[] = [
    { id: 'chat', label: '💬 Chat' },
    { id: 'keys', label: '🔑 Keys' },
    { id: 'agent', label: '🤖 Agent' },
  ];
  for (const d of defs) {
    const b = h('button', 'tg-tab', d.label) as HTMLButtonElement;
    b.dataset.tab = d.id;
    b.onclick = () => {
      tab = d.id;
      render();
    };
    tabsRow.appendChild(b);
  }

  app.appendChild(header);
  app.appendChild(tabsRow);
  app.appendChild(main);
  footer.innerHTML = '';
  footer.appendChild(
    h(
      'span',
      'tg-foot',
      '🔒 Keys sirf is device par encrypted · v3-local',
    ),
  );
  const links = h('span', 'tg-foot');
  const a = h('a', 'tg-link', 'Updates & APK') as HTMLAnchorElement;
  a.href = 'https://github.com/mokimarman8-star/tezgpt/releases';
  a.target = '_blank';
  a.rel = 'noopener';
  links.appendChild(a);
  const ps = h('span', 'tg-foot', '· Play Store: coming soon');
  links.appendChild(ps);
  footer.appendChild(links);
  app.appendChild(footer);
}

/* ------------------------------------------------------------------ */
/* Chat view                                                          */
/* ------------------------------------------------------------------ */

function renderChat(): HTMLElement {
  const wrap = h('div', 'tg-chat');
  const list = h('div', 'tg-msgs');
  list.id = 'tg-msglist';

  const empty = h('div', 'tg-empty');
  const bot = h('div', 'tg-bot-emoji', '🤖');
  empty.appendChild(bot);
  empty.appendChild(h('div', 'tg-title', 'TezGPT Ready'));
  empty.appendChild(
    h(
      'div',
      'tg-sub',
      hasKey === false
        ? 'Pehle 🔑 Keys tab mein AI key add karo — phir yahan message bhejo.'
        : 'Apni AI key se seedha baat karo — bina server, bina login.',
    ),
  );
  if (hasKey === false) {
    const addKey = h('button', 'tg-btn primary', '🔑 Add AI Key');
    addKey.onclick = () => {
      tab = 'keys';
      render();
    };
    empty.appendChild(addKey);
  }
  list.appendChild(empty);

  // history sidebar
  const side = h('div', 'tg-side');
  const sideTitle = h('div', 'tg-side-title', 'History');
  side.appendChild(sideTitle);
  const newBtn = h('button', 'tg-btn small', '＋ New chat');
  newBtn.onclick = () => {
    convo = null;
    render();
  };
  side.appendChild(newBtn);
  for (const c of convos.slice(0, 30)) {
    const row = h('div', `tg-side-item${convo?.id === c.id ? ' active' : ''}`);
    const open = h('button', 'tg-side-open', c.title || 'Untitled');
    open.onclick = () => {
      convo = c;
      render();
    };
    const del = h('button', 'tg-side-del', '✕');
    del.onclick = async () => {
      await deleteConversation(c.id);
      if (convo?.id === c.id) {
        convo = null;
      }
      await loadState();
      render();
    };
    row.appendChild(open);
    row.appendChild(del);
    side.appendChild(row);
  }
  if (convos.length === 0) {
    side.appendChild(h('div', 'tg-side-empty', 'Abhi koi chat nahi'));
  }

  // messages
  for (const m of convo?.messages ?? []) {
    const row = h('div', `tg-msg ${m.role}`);
    const bubble = h('div', 'tg-bubble', m.content);
    row.appendChild(bubble);
    list.appendChild(row);
  }
  const draftRow = h('div', 'tg-msg assistant');
  draftRow.id = 'tg-draftrow';
  draftRow.style.display = 'none';
  draftRow.appendChild(h('div', 'tg-bubble', ''));
  list.appendChild(draftRow);

  // composer
  const composer = h('div', 'tg-composer');
  const input = h('textarea', 'tg-input') as HTMLTextAreaElement;
  input.rows = 1;
  input.placeholder =
    'Message TezGPT… (key yahan paste karoge to wo khud Keys mein save ho jayegi)';
  const sendBtn = h('button', 'tg-send', '➤') as HTMLButtonElement;
  const stopBtn = h('button', 'tg-send stop', '■') as HTMLButtonElement;
  stopBtn.style.display = 'none';

  const doSend = async () => {
    const text = input.value.trim();
    if (!text || streaming) {
      return;
    }
    // ---- secret guard: tokens/keys NEVER go to AI ----
    const secrets = detectSecrets(text);
    if (secrets.length) {
      for (const s of secrets) {
        try {
          await saveSecret(s.kind, s.value, s.provider);
        } catch {
          /* ignore */
        }
      }
      input.value = '';
      toast('🔒 Key detected — Keys tab mein save ho gayi (AI ko nahi bheji)');
      await loadState();
      render();
      return;
    }
    input.value = '';
    streaming = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = '';
    const emptyEl = list.querySelector('.tg-empty');
    emptyEl?.remove();
    const apiKey = await getSecret('aiKey');
    if (!apiKey) {
      hasKey = false;
      const err = h('div', 'tg-msg assistant');
      err.appendChild(
        h('div', 'tg-bubble', '⚠️ Koi AI key nahi hai — 🔑 Keys tab mein add karo. (OpenRouter key best hai.)'),
      );
      list.insertBefore(err, draftRow);
      streaming = false;
      sendBtn.style.display = '';
      stopBtn.style.display = 'none';
      render();
      return;
    }
    if (!convo) {
      convo = {
        id: newId('c'),
        title: text.slice(0, 42),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
    }
    const userMsg: MemoryMessage = {
      id: newId('m'),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };
    const row = h('div', 'tg-msg user');
    row.appendChild(h('div', 'tg-bubble', text));
    list.insertBefore(row, draftRow);
    convo.messages.push(userMsg);
    await saveConversation(convo);

    // streaming
    const provider = providerForKey(apiKey);
    const history = convo.messages
      .filter((m) => m.content.trim() !== '')
      .slice(-12)
      .map((m) => ({
        role: (m.role === 'user' || m.role === 'assistant' ? m.role : 'user') as 'user' | 'assistant',
        content: m.content,
      }));
    const ctrl = new AbortController();
    abort = ctrl;
    let acc = '';
    draftRow.style.display = '';
    const bubble = draftRow.querySelector('.tg-bubble') as HTMLElement;
    list.scrollTop = list.scrollHeight;
    try {
      const full = await streamChat({
        provider,
        apiKey,
        model: '',
        messages: [{ role: 'system', content: buildSystemPrompt() }, ...history],
        signal: ctrl.signal,
        onDelta: (d) => {
          acc += d;
          bubble.textContent = acc;
          list.scrollTop = list.scrollHeight;
        },
      });
      draftRow.style.display = 'none';
      bubble.textContent = '';
      const am: MemoryMessage = { id: newId('m'), role: 'assistant', content: full, createdAt: Date.now() };
      convo.messages.push(am);
      const done = h('div', 'tg-msg assistant');
      done.appendChild(h('div', 'tg-bubble', full));
      list.insertBefore(done, draftRow);
      await saveConversation(convo);
      await loadState();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      draftRow.style.display = 'none';
      bubble.textContent = '';
      const errEl = h('div', 'tg-msg assistant');
      errEl.appendChild(h('div', 'tg-bubble', `❌ ${msg.slice(0, 400)}`));
      list.insertBefore(errEl, draftRow);
    } finally {
      streaming = false;
      abort = null;
      sendBtn.style.display = '';
      stopBtn.style.display = 'none';
      list.scrollTop = list.scrollHeight;
      render();
    }
  };

  sendBtn.onclick = doSend;
  stopBtn.onclick = () => abort?.abort();
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };
  input.onpaste = async (e) => {
    const pasted = e.clipboardData?.getData('text') ?? '';
    const secrets = detectSecrets(pasted);
    if (secrets.length) {
      e.preventDefault();
      for (const s of secrets) {
        try {
          await saveSecret(s.kind, s.value, s.provider);
        } catch {
          /* ignore */
        }
      }
      toast('🔒 Key detected — Keys tab mein save ho gayi');
      await loadState();
      render();
    }
  };
  composer.appendChild(input);
  composer.appendChild(sendBtn);
  composer.appendChild(stopBtn);

  wrap.appendChild(side);
  wrap.appendChild(list);
  wrap.appendChild(composer);
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Keys view                                                          */
/* ------------------------------------------------------------------ */

function keyField(kind: SecretKind, label: string, placeholder: string, hint: string): HTMLElement {
  const box = h('div', 'tg-keycard');
  const head = h('div', 'tg-keyhead');
  head.appendChild(h('span', 'tg-keylabel', label));
  const status = h('span', 'tg-chip ok', 'checking…');
  status.id = `tg-status-${kind}`;
  head.appendChild(status);
  box.appendChild(head);

  const row = h('div', 'tg-keyrow');
  const input = h('input', 'tg-input') as HTMLInputElement;
  input.type = 'password';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  const saveBtn = h('button', 'tg-btn small', 'Save') as HTMLButtonElement;
  const delBtn = h('button', 'tg-btn small danger', '✕') as HTMLButtonElement;
  delBtn.style.display = 'none';
  saveBtn.onclick = async () => {
    const v = input.value.trim();
    if (!v) {
      return;
    }
    const provider = kind === 'aiKey' ? detectProviderFromKey(v) : undefined;
    await saveSecret(kind, v, provider);
    input.value = '';
    toast(`🔒 ${label} saved (local encrypted)`);
    await loadState();
    render();
  };
  delBtn.onclick = async () => {
    await deleteSecret(kind);
    toast(`${label} removed`);
    await loadState();
    render();
  };
  row.appendChild(input);
  row.appendChild(saveBtn);
  row.appendChild(delBtn);
  box.appendChild(row);
  box.appendChild(h('div', 'tg-keyhint', hint));

  getSecretMeta(kind).then((meta) => {
    if (meta) {
      status.textContent = `saved: ${meta.masked}`;
      status.className = 'tg-chip ok';
      input.style.display = 'none';
      saveBtn.style.display = 'none';
      delBtn.style.display = '';
    } else {
      status.textContent = 'not set';
      status.className = 'tg-chip warn';
    }
  });
  return box;
}

function renderKeys(): HTMLElement {
  const wrap = h('div', 'tg-keys');
  wrap.appendChild(
    h(
      'div',
      'tg-note',
      '🔐 Ye keys sirf IS PHONE par encrypted (AES-GCM) rehti hain — koi server, koi log, koi analytics. Chat requests seedha aapke device se provider ko jaati hain.',
    ),
  );
  wrap.appendChild(
    keyField(
      'aiKey',
      'AI API Key',
      'sk-or-… / sk-ant-… / AIza… / sk-…',
      'OpenRouter (sk-or-…) best hai — browser se seedha chalti hai. Anthropic (sk-ant-…) aur Google (AIza…) bhi chalte hain. OpenAI (sk-…) WebView se CORS block karti hai — OpenRouter use karo.',
    ),
  );
  wrap.appendChild(
    keyField(
      'githubToken',
      'GitHub Token',
      'ghp_… / github_pat_…',
      'Agent mode ke git operations (commit/push/PR) ke liye — sirf tab use hota hai jab agent maange.',
    ),
  );
  wrap.appendChild(
    keyField(
      'imageKey',
      'Image-gen Key',
      'sk-… (image provider)',
      'Optional — image tasks ke liye. Nahi hai to wo tasks "pending" mark honge, baaki sab chalta rahega.',
    ),
  );
  return wrap;
}

/* ------------------------------------------------------------------ */
/* Agent view                                                         */
/* ------------------------------------------------------------------ */

function renderAgent(): HTMLElement {
  const wrap = h('div', 'tg-agent');
  wrap.appendChild(
    h(
      'div',
      'tg-note',
      '🤖 Agent mode: AI code likhta hai, plan banata hai, aur kaam track karta hai — sab is device par save hota hai. Note: TERMINAL commands ke liye self-hosted server chahiye (phone par terminal nahi chal sakta) — wo tasks honestly "pending/sandbox unavailable" dikhayenge, baaki sab chalta rahega.',
    ),
  );

  const form = h('div', 'tg-agent-form');
  const input = h('textarea', 'tg-input') as HTMLTextAreaElement;
  input.rows = 2;
  input.placeholder = 'Task do… e.g. "Python number-guessing game ka plan banao aur code likho"';
  const runBtn = h('button', 'tg-btn primary', '▶ Run') as HTMLButtonElement;
  runBtn.onclick = async () => {
    const text = input.value.trim();
    if (!text) {
      return;
    }
    input.value = '';
    runBtn.disabled = true;
    runBtn.textContent = 'running…';
    await runAgentTask({
      prompt: text,
      onUpdate: (t) => {
        currentTask = t;
        renderAgentTasks(wrap, t);
      },
    });
    runBtn.disabled = false;
    runBtn.textContent = '▶ Run';
    render();
  };
  form.appendChild(input);
  form.appendChild(runBtn);
  wrap.appendChild(form);

  const list = h('div', 'tg-tasklist');
  list.id = 'tg-tasklist';
  wrap.appendChild(list);
  loadTasks().then(() => {
    renderAgentTasks(wrap, currentTask ?? undefined);
  });
  return wrap;
}

let currentTask: AgentTaskRecord | null = null;
let allTasks: AgentTaskRecord[] = [];

async function loadTasks(): Promise<void> {
  allTasks = await listAgentTasksFromMemory();
}

async function listAgentTasksFromMemory(): Promise<AgentTaskRecord[]> {
  const { listAgentTasks } = await import('~/lib/byok/memory');
  return listAgentTasks(20);
}

function renderAgentTasks(wrap: HTMLElement, highlight?: AgentTaskRecord): void {
  const list = wrap.querySelector('#tg-tasklist') as HTMLElement;
  list.innerHTML = '';
  if (allTasks.length === 0 && !highlight) {
    list.appendChild(h('div', 'tg-sub', 'Abhi koi task nahi — upar se shuru karo.'));
    return;
  }
  const items = highlight ? [highlight, ...allTasks.filter((t) => t.id !== highlight.id)] : allTasks;
  for (const t of items.slice(0, 10)) {
    const card = h('div', `tg-task ${t.id === highlight?.id ? 'live' : ''}`);
    const top = h('div', 'tg-task-top');
    top.appendChild(h('span', 'tg-task-status', statusLabel(t.status)));
    top.appendChild(h('span', 'tg-task-time', new Date(t.updatedAt).toLocaleString()));
    card.appendChild(top);
    card.appendChild(h('div', 'tg-task-prompt', t.prompt.slice(0, 200)));
    if (t.steps.length > 0) {
      const steps = h('div', 'tg-task-steps');
      for (const s of t.steps.slice(-6)) {
        steps.appendChild(h('div', 'tg-step', `${iconFor(s.kind)} ${s.text.slice(0, 120)}`));
      }
      card.appendChild(steps);
    }
    if (t.pendingReasons?.length) {
      const pend = h('div', 'tg-task-pending', '⏳ Pending: ' + t.pendingReasons.join(' · '));
      card.appendChild(pend);
    }
    if (t.status === 'paused' || t.status === 'failed' || t.status === 'pending') {
      const resume = h('button', 'tg-btn small', '↻ Resume');
      resume.onclick = async () => {
        await resumeAgentTask(t.id, { onUpdate: (u) => renderAgentTasks(wrap, u) });
        render();
      };
      card.appendChild(resume);
    }
    list.appendChild(card);
  }
}

function statusLabel(s: string): string {
  return { running: '🟢 running', passed: '✅ passed', failed: '❌ failed', paused: '⏸ paused', pending: '⏳ pending', queued: '🕓 queued' }[s] ?? s;
}

function iconFor(k: string): string {
  return { write: '📝', run: '⚙️', test: '🧪', fix: '🔧', git: '🌿', plan: '🧠', error: '❗', info: 'ℹ️' }[k] ?? '•';
}

/* ------------------------------------------------------------------ */
/* State & render                                                     */
/* ------------------------------------------------------------------ */

async function loadState(): Promise<void> {
  const key = await getSecret('aiKey');
  hasKey = key != null;
  convos = await listConversations(50);
  if (!convo) {
    const ctx = await getResumeContext();
    if (ctx.lastConversation) {
      convo = ctx.lastConversation;
    }
  }
}

function render(): void {
  buildSkeleton();
  const chipEl = document.getElementById('tg-keychip');
  if (chipEl) {
    chipEl.textContent = hasKey ? '🔑 key ready' : '⚠️ no key';
    chipEl.className = `tg-chip ${hasKey ? 'ok' : 'warn'}`;
  }
  for (const b of Array.from(tabsRow.querySelectorAll('.tg-tab'))) {
    (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.tab === tab);
  }
  main.innerHTML = '';
  if (tab === 'chat') {
    main.appendChild(renderChat());
  } else if (tab === 'keys') {
    main.appendChild(renderKeys());
  } else {
    main.appendChild(renderAgent());
  }
}

async function boot(): Promise<void> {
  await loadState();
  render();
}

boot().catch((e) => {
  app.innerHTML = '';
  app.appendChild(
    h('div', 'tg-note', `TezGPT load error: ${e instanceof Error ? e.message : String(e)}`),
  );
});
