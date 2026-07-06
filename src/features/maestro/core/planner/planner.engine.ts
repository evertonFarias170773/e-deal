import { PLAN_TEMPLATES } from './planner.templates';
import { createStep } from './planner.steps';
import type { ExecutionPlan, PlanStep } from './planner.types';
import type { ConversationContext } from '../../types';

export function buildExecutionPlan(context: ConversationContext): ExecutionPlan | null {
  if (!context.intentId) return null;

  const templateFactory = PLAN_TEMPLATES[context.intentId];
  
  let steps: PlanStep[] = [];
  if (templateFactory) {
    steps = templateFactory();
  } else {
    // Fallback generic plan
    steps = [
      createStep('step-gen-1', {
        title: 'Identificar contexto',
        description: 'Analisar solicitação genérica.',
        type: 'identify',
        executionMode: 'auto',
      }),
      createStep('step-gen-2', {
        title: `Consultar especialista`,
        description: 'Buscar informações relevantes no módulo adequado.',
        type: 'search',
        executionMode: 'auto',
      }),
      createStep('step-gen-3', {
        title: 'Preparar resposta',
        description: 'Gerar resposta baseada no conhecimento do especialista.',
        type: 'respond',
        executionMode: 'auto',
      }),
    ];
  }

  const planId = `plan-${Date.now()}`;

  return {
    id: planId,
    title: `Plano: ${context.intent} ${context.targetObject || ''}`.trim(),
    summary: `Execução roteirizada para o domínio ${context.domain || 'Geral'}.`,
    status: 'planned',
    confidence: context.confidence || 'medium',
    estimatedSteps: steps.length,
    estimatedSpecialist: context.specialist || 'geral',
    steps,
  };
}
