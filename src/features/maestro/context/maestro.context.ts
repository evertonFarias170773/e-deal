import { createContext } from 'react';
import type { ConversationSession, ConversationMessage, ActivityStep, ConversationContext } from '../types';

export interface MaestroState {
  sessions: ConversationSession[];
  activeSessionId: string | null;
  messages: ConversationMessage[];
  activity: ActivityStep[];
  context: ConversationContext;
  isLoading: boolean;
  /** Flag injetada pelo servidor via page.tsx — ativa OpenAI se true */
  llmEnabled: boolean;
}

export interface MaestroActions {
  setSessions: React.Dispatch<React.SetStateAction<ConversationSession[]>>;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessage[]>>;
  setActivity: React.Dispatch<React.SetStateAction<ActivityStep[]>>;
  setContext: React.Dispatch<React.SetStateAction<ConversationContext>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

export type MaestroContextType = MaestroState & MaestroActions;

export const MaestroContext = createContext<MaestroContextType | undefined>(undefined);