'use client';
import { Bot } from 'lucide-react';

export function MaestroLoadingBubble() {
  return (
    <div className="flex justify-start mb-6">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-blue-700 flex items-center justify-center shrink-0 mt-0.5 shadow-md">
          <Bot size={14} className="text-white" />
        </div>
        <div className="bg-[var(--card)] dark:bg-white/5 border border-[var(--border)] dark:border-white/10 rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm">
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full animate-bounce"
              style={{ background: 'var(--secondary)', animationDelay: '0ms' }}
            />
            <span
              className="w-2 h-2 rounded-full animate-bounce"
              style={{ background: 'var(--secondary)', animationDelay: '160ms' }}
            />
            <span
              className="w-2 h-2 rounded-full animate-bounce"
              style={{ background: 'var(--secondary)', animationDelay: '320ms' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
