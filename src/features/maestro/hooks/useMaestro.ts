'use client';
import { useContext, useRef, useCallback, useState } from 'react';
import { MaestroContext } from '../context/maestro.context';
import { useConversationManagerSimple as useConversationManager } from '../core/conversation/conversation.manager.simple';

export function useMaestro() {
  const context = useContext(MaestroContext);
  if (!context) throw new Error('useMaestro must be used within MaestroProvider');

  const {
    sessions,
    activeSessionId,
    messages,
    activity,
    context: maestroContext,
    isLoading,
  } = context;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const manager = useConversationManager();
  const [inputValue, setInputValue] = useState('');

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const sendMessage = useCallback((query: string) => {
    manager.sendMessage(query, scrollToBottom);
  }, [manager, scrollToBottom]);

  const handleSend = useCallback((query: string) => {
    sendMessage(query);
    setInputValue('');
  }, [sendMessage]);

  return {
    sessions,
    activeSessionId,
    messages,
    activity,
    context: maestroContext,
    isLoading,
    inputValue,
    setInputValue,
    messagesEndRef,
    startNewChat: manager.startNewChat,
    openSession: manager.openSession,
    sendMessage: handleSend,
    restoreLastConversation: manager.restoreLastConversation,
  };
}
