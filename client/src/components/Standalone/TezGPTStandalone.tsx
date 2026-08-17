/**
 * TezGPT — Standalone Home (BYOK mode, no server)
 * APK/standalone mein ye screen seedha khulti hai (no login):
 *  - Quick Chat  (BYOK direct provider streaming)
 *  - Agent Mode  (sandbox tasks, background queue, memory resume)
 *  - Keys        (AI key / GitHub token / image key — encrypted local vault)
 */

import { useState } from 'react';
import { Bot, KeyRound, MessageSquare, ShieldCheck } from 'lucide-react';
import QuickChat from './QuickChat';
import AgentMode from '~/components/AgentMode/AgentMode';
import SubtleIndicator from '~/components/Byok/SubtleIndicator';
import ByokPanel from '~/components/Nav/SettingsTabs/Byok/ByokPanel';
import { APP_RELEASES_URL, PLAY_STORE_URL } from '~/constants/downloadLinks';

type Tab = 'chat' | 'agent' | 'keys';

export default function TezGPTStandalone() {
  const [tab, setTab] = useState<Tab>('chat');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={15} /> },
    { id: 'agent', label: 'Agent', icon: <Bot size={15} /> },
    { id: 'keys', label: 'Keys', icon: <KeyRound size={15} /> },
  ];

  return (
    <div className="flex h-full min-h-screen flex-col bg-surface-primary">
      {/* header */}
      <header className="flex items-center justify-between border-b border-border-light px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-primary text-white">
            <Bot size={17} />
          </span>
          <div>
            <h1 className="text-sm font-bold leading-tight text-text-primary">
              Tez<span className="text-brand-gradient">GPT</span>
            </h1>
            <p className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <ShieldCheck size={10} /> BYOK · keys aapke device par
            </p>
          </div>
        </div>
        <nav className="flex items-center gap-1 rounded-xl bg-surface-secondary p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'bg-accent-primary text-white'
                  : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* content */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === 'chat' && <QuickChat onOpenKeys={() => setTab('keys')} />}
        {tab === 'agent' && (
          <div className="h-full overflow-y-auto">
            <AgentMode onBack={() => setTab('chat')} />
          </div>
        )}
        {tab === 'keys' && (
          <div className="h-full overflow-y-auto px-4 py-5">
            <div className="mx-auto max-w-2xl">
              <ByokPanel />
            </div>
          </div>
        )}
      </main>

      {/* footer */}
      <footer className="flex items-center justify-between border-t border-border-light px-4 py-2 text-[10px] text-text-tertiary">
        <span>TezGPT · privacy-first AI workspace</span>
        <span className="flex items-center gap-3">
          <a
            href={APP_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent-primary hover:underline"
          >
            Updates
          </a>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent-primary hover:underline"
          >
            Play Store: coming soon
          </a>
        </span>
      </footer>
      <SubtleIndicator />
    </div>
  );
}
