/**
 * TezGPT — Quick Chat (BYOK standalone)
 * Local-first chat: aapki AI key se DIRECT provider call (streaming),
 * history IndexedDB (memory store) mein — koi server nahi.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, Plus, KeyRound, Bot, User as UserIcon } from 'lucide-react';
import { getSecret } from '~/lib/byok/vault';
import { providerForKey, streamChat, buildSystemPrompt } from '~/lib/byok/provider';
import { useSecretGuard } from '~/hooks/byok/useSecretGuard';
import { Square } from 'lucide-react';
import type { ChatMessage } from '~/lib/byok/provider';
import {
  newId,
  saveConversation,
  getResumeContext,
  type ConversationRecord,
  type MemoryMessage,
} from '~/lib/byok/memory';

interface QuickChatProps {
  onOpenKeys: () => void;
}

export default function QuickChat({ onOpenKeys }: QuickChatProps) {
  const [convo, setConvo] = useState<ConversationRecord | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [model, setModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { guardText } = useSecretGuard();

  const messages = useMemo(() => convo?.messages ?? [], [convo]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const key = await getSecret('aiKey');
      if (mounted) {
        setHasKey(key != null);
      }
      const ctx = await getResumeContext();
      if (mounted && ctx.lastConversation) {
        setConvo(ctx.lastConversation);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, busy]);

  const newChat = useCallback(() => {
    setConvo(null);
    setError(null);
  }, []);

  const ensureConvo = useCallback((): ConversationRecord => {
    if (convo) {
      return convo;
    }
    const fresh: ConversationRecord = {
      id: newId('convo'),
      title: 'Quick Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    setConvo(fresh);
    return fresh;
  }, [convo]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    // TezGPT: secret guard — tokens/keys silently → Settings, kabhi AI ko nahi
    const guard = await guardText(text);
    if (guard.blocked) {
      setInput('');
      return;
    }
    setBusy(true);
    setError(null);
    setInput('');
    try {
      const apiKey = await getSecret('aiKey');
      if (!apiKey) {
        setHasKey(false);
        onOpenKeys();
        return;
      }
      setHasKey(true);
      const provider = providerForKey(apiKey);

      const current = ensureConvo();
      const userMsg: MemoryMessage = {
        id: newId('msg'),
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };
      const assistantMsg: MemoryMessage = {
        id: newId('msg'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      const updated: ConversationRecord = {
        ...current,
        title: current.title === 'Quick Chat' && current.messages.length === 0 ? text.slice(0, 42) : current.title,
        messages: [...current.messages, userMsg, assistantMsg],
      };
      setConvo(updated);
      await saveConversation(updated);

      // NOTE: empty assistant placeholder kabhi API ko nahi bhejte (Anthropic reject karta hai)
      const history: ChatMessage[] = updated.messages
        .filter((m) => m.role !== 'system' && m.content.trim() !== '')
        .slice(-20)
        .map((m) => ({
          role: m.role === 'user' || m.role === 'assistant' ? m.role : 'user',
          content: m.content,
        }));

      let assistantText = '';
      const controller = new AbortController();
      abortRef.current = controller;
      await streamChat({
        provider,
        apiKey,
        model: model.trim() || undefined,
        messages: [{ role: 'system', content: buildSystemPrompt() }, ...history],
        signal: controller.signal,
        onDelta: (delta) => {
          assistantText += delta;
          setConvo((c) => {
            if (!c) {
              return c;
            }
            const msgs = [...c.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: assistantText };
            }
            return { ...c, messages: msgs };
          });
        },
      });
      const final: ConversationRecord = {
        ...updated,
        messages: [
          ...updated.messages.slice(0, -1),
          { ...assistantMsg, content: assistantText },
        ],
      };
      setConvo(final);
      await saveConversation(final);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.slice(0, 300));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [input, busy, ensureConvo, model, onOpenKeys, guardText]);

  return (
    <div className="flex h-full flex-col">
      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Bot size={40} className="text-accent-primary" />
            <p className="max-w-xs text-sm text-text-secondary">
              {hasKey === false
                ? 'Pehle Settings → Keys mein apni AI API key add karo — phir yahan chat karo.'
                : 'Apni key se direct chat — messages aapke device par hi save hote hain.'}
            </p>
            {hasKey === false && (
              <button
                type="button"
                onClick={onOpenKeys}
                className="flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-semibold text-white hover:bg-accent-primary-hover"
              >
                <KeyRound size={14} /> Add AI Key
              </button>
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role !== 'user' && (
              <span className="mt-1 shrink-0 text-accent-primary">
                <Bot size={16} />
              </span>
            )}
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-br-sm bg-accent-primary text-white'
                  : 'rounded-bl-sm bg-surface-secondary text-text-primary'
              }`}
            >
              {m.content}
              {busy && m.role === 'assistant' && m.content === '' && (
                <span className="inline-flex items-center gap-1 text-text-tertiary">
                  <Loader2 size={12} className="animate-spin" /> typing…
                </span>
              )}
            </div>
            {m.role === 'user' && (
              <span className="mt-1 shrink-0 text-text-tertiary">
                <UserIcon size={16} />
              </span>
            )}
          </div>
        ))}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            {error}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-border-light p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={newChat}
            aria-label="new chat"
            className="rounded-lg border border-border-medium p-2 text-text-secondary hover:bg-surface-hover"
          >
            <Plus size={16} />
          </button>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model (optional)"
            className="w-32 rounded-lg border border-border-medium bg-surface-primary px-2 py-2 text-xs text-text-primary outline-none focus:border-accent-primary"
          />
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border-medium bg-surface-primary px-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onPaste={async (e) => {
                const pasted = e.clipboardData?.getData('text') ?? '';
                const guard = await guardText(pasted);
                if (guard.blocked) {
                  e.preventDefault();
                  setInput('');
                }
              }}
              rows={1}
              placeholder="Message TezGPT… (key paste ki to seedha Keys tab mein save)"
              className="min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm text-text-primary outline-none"
            />
            {busy && (
              <button
                type="button"
                onClick={stop}
                aria-label="stop"
                className="rounded-lg bg-red-500 p-2 text-white"
              >
                <Square size={16} fill="currentColor" />
              </button>
            )}
            <button
              type="button"
              onClick={send}
              disabled={busy || !input.trim()}
              aria-label="send"
              className="rounded-lg bg-accent-primary p-2 text-white hover:bg-accent-primary-hover disabled:opacity-40"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-text-tertiary">
          🔒 Keys aapke device par encrypted hain — server par kabhi nahi jaati
        </p>
      </div>
    </div>
  );
}
