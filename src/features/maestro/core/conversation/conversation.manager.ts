'use client';
import { useContext, useCallback, useRef } from 'react';
import { MaestroContext } from '../../context/maestro.context';
import type { ConversationMessage, ConversationSession } from '../../types';
import { getMockResponse } from '../../services/maestro.service.mock';
import { MOCK_WELCOME_MESSAGES, MOCK_INITIAL_CONTEXT } from '../../mocks/maestro.mock';
import { buildContext } from '../context/context.builder';
import { buildExecutionPlan } from '../planner/planner.engine';
import { resolveRegistryForPlan } from '../registry/registry.engine';
import { evaluatePolicy } from '../policy/policy.engine';
import { buildPolicyRequest } from '../policy/policy.context';
import { executeTool } from '../tools/tools.executor';
import { generateResponse } from '../response/response.engine';
import { generateAIResponse } from '../ai/ai.gateway';

export function useConversationManager() {
  const context = useContext(MaestroContext);
  if (!context) throw new Error('Must be used within MaestroProvider');

  const {
    sessions, setSessions,
    activeSessionId, setActiveSessionId,
    messages, setMessages,
    setActivity,
    context: globalContext,
    setContext: setGlobalContext,
    setIsLoading,
    llmEnabled,
  } = context;

  // CRITICAL FIX: useRef para sempre ter o contexto mais recente dentro do useCallback.
  // Sem isso, sendMessage usaria uma cópia antiga (stale closure) do globalContext.
  const globalContextRef = useRef(globalContext);
  globalContextRef.current = globalContext;

  const startNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages(MOCK_WELCOME_MESSAGES);
    setActivity([]);
    setGlobalContext(MOCK_INITIAL_CONTEXT);
  }, [setActiveSessionId, setMessages, setActivity, setGlobalContext]);

  const openSession = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setMessages(MOCK_WELCOME_MESSAGES); // Currently no history is kept per session, this simulates loading a clean chat or would load history
    setActivity([]);
    setGlobalContext({ company: 'Ideal', specialist: session.specialist || 'geral' });
  }, [sessions, setActiveSessionId, setMessages, setActivity, setGlobalContext]);

  const sendMessage = useCallback(async (query: string, scrollToBottom: () => void) => {
    if (!query.trim()) return;

    // 1. Add User Message
    const userMsg: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      contentType: 'text',
      timestamp: new Date().toISOString(),
      status: 'completed',
    };

    // 2. Add Initial "Thinking" Message
    const aiMsgId = `maestro-${Date.now()}`;
    const initialAiMsg: ConversationMessage = {
      id: aiMsgId,
      role: 'maestro',
      content: '',
      contentType: 'text',
      timestamp: new Date().toISOString(),
      status: 'thinking',
    };

    setMessages(prev => [...prev, userMsg, initialAiMsg]);
    setIsLoading(true);
    scrollToBottom();

    // 3. Set independent activity states & update intelligent context
    // SEMPRE usar o ref para pegar o contexto atual, não o closure antigo
    const currentGlobalContext = globalContextRef.current;
    const enrichedContext = buildContext(query, currentGlobalContext);
    
    // 4. Build Execution Plan & Registry Resolution
    const plan = buildExecutionPlan(enrichedContext);
    if (plan) {
      enrichedContext.activePlan = plan;
      const registryResolution = resolveRegistryForPlan(plan);
      enrichedContext.registryResolution = registryResolution;
    }
    setGlobalContext(enrichedContext);

    let latestContext = enrichedContext;

    // 5. Run Simulated Timeline based on Plan
    if (plan && plan.steps.length > 0) {
      const initialActivities = plan.steps.map(step => ({
         id: step.id,
         label: step.title,
         status: 'planned' as const
      }));
      setActivity(initialActivities as any); // using 'any' to bypass strict status types if needed

      for (let i = 0; i < plan.steps.length; i++) {
         const step = plan.steps[i];
         
         setActivity(prev => prev.map(s => s.id === step.id ? { ...s, status: 'running' } : s));
         await new Promise(r => setTimeout(r, 400 + Math.random() * 200));

         if (step.estimatedTool) {
            const registryResult = enrichedContext.registryResolution?.results.find(r => r.stepId === step.id);
            if (registryResult) {
               setActivity(prev => [...prev, { id: `${step.id}-t1`, label: `Localizando ferramenta...`, status: 'running' }]);
               await new Promise(r => setTimeout(r, 200));
               setActivity(prev => prev.map(s => s.id === `${step.id}-t1` ? { ...s, label: `Tool identificada (${registryResult.toolId})`, status: 'done', timestamp: new Date().toLocaleTimeString('pt-BR') } : s));
               
               // POLICY ENGINE INTERCEPTION
               setActivity(prev => [...prev, { id: `${step.id}-policy1`, label: `Policy analisando...`, status: 'running' }]);
               await new Promise(r => setTimeout(r, 200));

               const policyRequest = buildPolicyRequest(latestContext, step, registryResult);
               const policyDecision = evaluatePolicy(policyRequest);

               latestContext = {
                 ...latestContext,
                 policyDecisions: {
                   ...(latestContext.policyDecisions || {}),
                   [registryResult.toolId]: policyDecision
                 }
               };
               setGlobalContext(latestContext);

               setActivity(prev => prev.map(s => s.id === `${step.id}-policy1` ? { ...s, label: `Permissão validada`, status: 'done', timestamp: new Date().toLocaleTimeString('pt-BR') } : s));

               if (policyDecision.canExecute) {
                 setActivity(prev => [...prev, { id: `${step.id}-policy2`, label: `Execução autorizada`, status: 'done', timestamp: new Date().toLocaleTimeString('pt-BR') }]);
                 setActivity(prev => [...prev, { id: `${step.id}-t3`, label: `Acessando ERP...`, status: 'running' }]);
                 
                 // EXECUTION LAYER
                 const executionResult = await executeTool(registryResult.toolId, {
                   targetObject: latestContext.targetObject,
                   // clientId legacy (string display code)
                   clientId: latestContext.clientId,
                   // Separated IDs: display code vs internal integer
                   clientInternalId: latestContext.clientInternalId,
                   clientDisplayCode: latestContext.clientDisplayCode || latestContext.clientId,
                   // Name-based search (when user types a company name without code)
                   clientSearchName: latestContext.clientSearchName,
                   clientName: latestContext.clientName,
                   // Intent type to differentiate orcamento (open) vs pedido (is_prd_aprovado=true)
                   intentType: latestContext.targetObject === 'pedido' ? 'pedido' : 'proposta',
                   // Proposta específica: id_int explícito na query (prioridade sobre contexto de cliente)
                   activeIdInt: latestContext.activeIdInt,
                 });
                 
                 let newClientContext = {};
                 if (registryResult.toolId === 'clientes.consultar' && executionResult.success && executionResult.data?.length === 1) {
                   const c = executionResult.data[0];
                   newClientContext = {
                     clientId: c.idCliente?.toString(),           // string display code (retrocompat)
                     clientDisplayCode: c.idCliente?.toString(),  // alias explícito
                     clientInternalId: typeof c.idClienteInterno === 'number' ? c.idClienteInterno : undefined, // inteiro interno
                     clientCode: c.idCliente?.toString(),
                     clientName: c.razaoSocial,
                     clientDocument: c.cpfCnpj,
                     clientCityUf: c.cidade,
                   };
                 }

                 latestContext = {
                   ...latestContext,
                   ...newClientContext,
                   toolResults: {
                     ...(latestContext.toolResults || {}),
                     [registryResult.toolId]: executionResult
                   }
                 };
                 setGlobalContext(latestContext);

                 setActivity(prev => prev.map(s => s.id === `${step.id}-t3` ? { ...s, label: `Concluído (${executionResult.executionTime}ms)`, status: 'done', timestamp: new Date().toLocaleTimeString('pt-BR') } : s));
               } else {
                 const blockLabel = policyDecision.status === 'requires_confirmation' ? 'Aguardando aprovação' : 'Execução bloqueada';
                 setActivity(prev => [...prev, { id: `${step.id}-policy2`, label: blockLabel, status: 'done', timestamp: new Date().toLocaleTimeString('pt-BR') }]);
               }
            }
         }

         setActivity(prev => prev.map(s => s.id === step.id ? { ...s, status: 'done', timestamp: new Date().toLocaleTimeString('pt-BR') } : s));
         
         setGlobalContext(prev => {
           if (!prev.activePlan) return prev;
           const updatedSteps = prev.activePlan.steps.map(ps => ps.id === step.id ? { ...ps, status: 'completed' as const } : ps);
           return { ...prev, activePlan: { ...prev.activePlan, steps: updatedSteps } };
         });
      }
    } else {
      setActivity([{ id: 'step-1', label: 'Analisando solicitação...', status: 'running' }]);
      await new Promise(r => setTimeout(r, 600));
      setActivity([{ id: 'step-1', label: 'Analisando solicitação', status: 'done', timestamp: new Date().toLocaleTimeString('pt-BR') }]);
    }

     // 6. Generate Structural Response (Cards, Tables)
     const { model: responseModel, metadata: responseMetadata } = generateResponse(latestContext);
     
     // 7. AI Gateway (The empathy and logic layer)
     setActivity(prev => [...prev, { id: 'ai-gateway', label: 'Invocando AI Gateway...', status: 'running' }]);
     
     const aiResponse = await generateAIResponse(query, latestContext, responseModel, responseMetadata, llmEnabled);
     
     setActivity(prev => prev.map(s => s.id === 'ai-gateway' ? { ...s, label: `Resposta Gerada via ${aiResponse.provider} (${aiResponse.latency}ms)`, status: 'done', timestamp: new Date().toLocaleTimeString('pt-BR') } : s));
     
     const finalContent = aiResponse.content;
     responseModel.summary = finalContent;

     // Update Context one last time if response needs to push something
     setGlobalContext(latestContext);

     // 8. Streaming Effect (Typewriter for text summary)
     setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, status: 'streaming' } : m));

     const contentToStream = finalContent;
    let currentText = '';

    for (let i = 0; i < contentToStream.length; i++) {
      currentText += contentToStream[i];
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: currentText } : m));
      // Typewriter delay: 5ms - 25ms per char
      await new Promise(r => setTimeout(r, Math.random() * 20 + 5));
      // Auto-scroll every few chars to keep smooth
      if (i % 5 === 0) scrollToBottom();
    }

    // 9. Complete message (attach components/sources/response)
    setMessages(prev => prev.map(m => m.id === aiMsgId ? {
      ...m,
      status: 'completed',
      contentType: 'text', // deprecated now we have ResponseModel
      responseModel,
      responseMetadata,
      specialist: latestContext.specialist,
      confidence: aiResponse.confidence > 0.8 ? 'high' : 'medium',
    } : m));

    setIsLoading(false);
    scrollToBottom();

    // 10. Session Creation
    if (!activeSessionId) {
      const newSession: ConversationSession = {
        id: `sess-new-${Date.now()}`,
        title: query.length > 45 ? query.slice(0, 42) + '...' : query,
        summary: responseModel.summary.replace(/\*\*/g, '').slice(0, 60) + '...',
        lastMessage: responseModel.summary.replace(/\*\*/g, '').slice(0, 60),
        updatedAt: new Date().toISOString(),
        specialist: latestContext.specialist,
      };
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
    }

  }, [activeSessionId, setMessages, setIsLoading, setActivity, setGlobalContext, setSessions, setActiveSessionId]);

  return {
    startNewChat,
    openSession,
    sendMessage,
  };
}