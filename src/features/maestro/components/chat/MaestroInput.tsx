'use client';
import { Send, Plus, Wrench, Mic } from 'lucide-react';
import { useRef, useEffect } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: (v: string) => void;
  isLoading: boolean;
}

export function MaestroInput({ value, onChange, onSend, isLoading }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Focus input when loading finishes
  useEffect(() => {
    if (!isLoading && ref.current) {
      setTimeout(() => ref.current?.focus(), 100);
    }
  }, [isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading) onSend(value);
    }
  };

  return (
    <div className="bg-[var(--card)] dark:bg-[#0d1b2a] px-6 py-4">
      <div className="max-w-4xl mx-auto relative">
        <div
          className="flex flex-col rounded-[24px] border-2 bg-[var(--background)] dark:bg-white/5 transition-all duration-300 focus-within:border-[var(--secondary)] focus-within:shadow-[0_0_20px_rgba(var(--secondary-rgb),0.1)] focus-within:bg-[var(--card)]"
          style={{
            borderColor: 'var(--border)',
          }}
        >
          <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte qualquer coisa sobre clientes, propostas, pedidos, produção, financeiro, notas fiscais..."
            rows={1}
            disabled={isLoading}
            className="resize-none bg-transparent px-5 pt-4 pb-1 text-[15px] text-[var(--foreground)] dark:text-white placeholder-[var(--muted)]/70 dark:placeholder-white/30 outline-none w-full min-h-[56px] max-h-[200px] disabled:opacity-60 leading-relaxed scrollbar-thin"
          />
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            {/* Left actions */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled
                className="p-2 rounded-lg text-[var(--muted)] dark:text-white/40 hover:bg-[var(--border)] dark:hover:bg-white/10 hover:text-[var(--foreground)] dark:hover:text-white transition-all cursor-not-allowed opacity-80"
                title="Microfone (em breve)"
              >
                <Mic size={18} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => value.trim() && !isLoading && onSend(value)}
              disabled={!value.trim() || isLoading}
              className="flex items-center justify-center w-8 h-8 rounded-full text-white disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-md"
              style={{ background: 'var(--secondary)' }}
            >
              <Send size={14} className="ml-0.5" />
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-[var(--muted)]/60 dark:text-white/20 mt-2 font-medium">
          Maestro ERP Ideal · Inteligência Assistida
        </p>
      </div>
    </div>
  );
}
