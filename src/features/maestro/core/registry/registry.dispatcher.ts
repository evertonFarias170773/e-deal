import { TOOL_CATALOG } from './registry.catalog';
import type { RegistryResult } from './registry.result';
import type { PlanStep } from '../planner/planner.types';

export function dispatchToolForStep(step: PlanStep): RegistryResult {
  if (!step.estimatedTool) {
    return {
      stepId: step.id,
      toolId: 'unknown',
      status: 'missing_params',
      executionMode: step.executionMode,
      reason: 'Passo do plano não possui uma ferramenta designada.',
    };
  }

  // Remove the "tool:" prefix used in templates
  const toolId = step.estimatedTool.replace('tool:', '');
  const tool = TOOL_CATALOG.find(t => t.id === toolId);

  if (!tool) {
    return {
      stepId: step.id,
      toolId,
      status: 'not_found',
      executionMode: step.executionMode,
      reason: `Ferramenta '${toolId}' não encontrada no catálogo do ERP.`,
    };
  }

  if (tool.status === 'offline' || tool.status === 'deprecated') {
    return {
      stepId: step.id,
      toolId,
      tool,
      status: 'not_found',
      executionMode: tool.executionMode,
      reason: `A ferramenta '${toolId}' encontra-se inativa ou obsoleta.`,
    };
  }

  if (tool.executionMode === 'blocked') {
    return {
      stepId: step.id,
      toolId,
      tool,
      status: 'blocked',
      executionMode: tool.executionMode,
      reason: `Restrição de política: A ferramenta '${toolId}' encontra-se bloqueada.`,
    };
  }

  if (tool.executionMode === 'confirm') {
    return {
      stepId: step.id,
      toolId,
      tool,
      status: 'pending_confirmation',
      executionMode: tool.executionMode,
      reason: `Ação protegida: Requer aprovação explícita antes da execução.`,
      estimatedDuration: 1000,
    };
  }

  return {
    stepId: step.id,
    toolId,
    tool,
    status: 'ready',
    executionMode: tool.executionMode,
    reason: 'Ferramenta localizada, validada e pronta para execução assíncrona.',
    estimatedDuration: 500,
  };
}
