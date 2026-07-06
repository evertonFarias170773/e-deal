'use client';
import { useState, ReactNode } from 'react';
import { MaestroContext } from '../context/maestro.context';
import { MOCK_SESSIONS, MOCK_WELCOME_MESSAGES, MOCK_INITIAL_CONTEXT } from '../mocks/maestro.mock';
import type { ActivityStep } from '../types';

interface MaestroProviderProps {
  children: ReactNode;
  /** Injetado pelo servidor (page.tsx) via process.env.MAESTRO_LLM_ENABLED. Nunca NEXT_PUBLIC_. */
  llmEnabled?: boolean;
}

export function MaestroProvider({ children, llmEnabled = false }: MaestroProviderProps) {
  const [sessions, setSessions] = useState(MOCK_SESSIONS);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState(MOCK_WELCOME_MESSAGES);
  const [activity, setActivity] = useState<ActivityStep[]>([]);
  const [context, setContext] = useState(MOCK_INITIAL_CONTEXT);
  const [isLoading, setIsLoading] = useState(false);

  return (
    <MaestroContext.Provider
      value={{
        sessions,
        setSessions,
        activeSessionId,
        setActiveSessionId,
        messages,
        setMessages,
        activity,
        setActivity,
        context,
        setContext,
        isLoading,
        setIsLoading,
        llmEnabled,
      }}
    >
      {children}
    </MaestroContext.Provider>
  );
}