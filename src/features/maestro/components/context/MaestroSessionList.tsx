'use client';
import { MessageSquare, Plus, Search, Clock } from 'lucide-react';
import type { ConversationSession, SpecialistType } from '../../types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}min atrás`;
  if (hours < 24) return `${hours}h atrás`;
  if (days === 1) return 'Ontem';
  return `${days} dias atrás`;
}

function groupSessions(sessions: ConversationSession[]) {
  const now = Date.now();
  const today: ConversationSession[] = [];
  const yesterday: ConversationSession[] = [];
  const week: ConversationSession[] = [];
  
  if (sessions.length <= 5) {
    return { recent: sessions, today: [], yesterday: [], week: [] };
  }

  for (const s of sessions) {
    const diff = now - new Date(s.updatedAt).getTime();
    const hours = diff / 3600000;
    if (hours < 24) today.push(s);
    else if (hours < 48) yesterday.push(s);
    else week.push(s);
  }
  return { recent: [], today, yesterday, week };
}

const SPECIALIST_DOT: Record<SpecialistType, string> = {
  comercial: 'bg-blue-400',
  financeiro: 'bg-emerald-400',
  produtos: 'bg-purple-400',
  producao: 'bg-orange-400',
  fiscal: 'bg-yellow-400',
  expedicao: 'bg-cyan-400',
  geral: 'bg-slate-400',
};

interface Props {
  sessions: ConversationSession[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onOpenSession: (id: string) => void;
}

export function MaestroSessionList({ sessions, activeSessionId, onNewChat, onOpenSession }: Props) {
  return (
    <div className="flex flex-col h-full w-56 shrink-0 border-r border-[var(--border)]" style={{ background: '#F7F8FA' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 px-1">
          <div className="w-6 h-6 rounded-lg overflow-hidden flex items-center justify-center shadow-sm">
            <img src="/agent_maestro_light_mode.png" alt="Maestro" className="w-full h-full object-contain" />
          </div>
          <span className="text-slate-800 font-bold text-[13px] tracking-tight">Maestro</span>
        </div>
        <button
          onClick={onNewChat}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-blue-600 transition-all"
          title="Nova Conversa"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function SessionGroup({
  label,
  sessions,
  activeId,
  onOpen,
}: {
  label: string;
  sessions: ConversationSession[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mb-3">
      <p className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      {sessions.map(session => (
        <button
          key={session.id}
          onClick={() => onOpen(session.id)}
          className={`w-full text-left px-3 py-2 mx-1 rounded-xl transition-all ${
            activeId === session.id
              ? 'bg-blue-50 text-blue-700 border border-blue-100 shadow-sm'
              : 'text-slate-600 hover:bg-white hover:border hover:border-[var(--border)] hover:shadow-sm border border-transparent'
          }`}
          style={{ width: 'calc(100% - 8px)' }}
        >
          <div className="flex items-start gap-2">
            <div
              className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${SPECIALIST_DOT[session.specialist || 'geral']}`}
            />
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] font-semibold truncate leading-tight ${activeId === session.id ? 'text-blue-700' : 'text-slate-700'}`}>{session.title}</p>
              <p className="text-[10px] text-slate-400 truncate mt-0.5 leading-tight">{session.summary}</p>
              <div className="flex items-center gap-1 mt-1.5">
                <Clock size={8} className="text-slate-300" />
                <span className="text-[9px] text-slate-400">{timeAgo(session.updatedAt)}</span>
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
