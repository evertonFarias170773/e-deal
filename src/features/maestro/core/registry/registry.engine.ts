import { dispatchToolForStep } from './registry.dispatcher';
import type { RegistryResolution, RegistryResult } from './registry.result';
import type { ExecutionPlan } from '../planner/planner.types';

export function resolveRegistryForPlan(plan: ExecutionPlan): RegistryResolution {
  const results: RegistryResult[] = [];
  const missingTools: string[] = [];
  const blockedTools: string[] = [];
  const pendingConfirmationTools: string[] = [];
  const readyTools: string[] = [];

  for (const step of plan.steps) {
    // Apenas despachar passos que possuem uma intenção de usar ferramenta
    if (step.estimatedTool) {
      const result = dispatchToolForStep(step);
      results.push(result);

      if (result.status === 'not_found' || result.status === 'missing_params') {
        missingTools.push(result.toolId);
      } else if (result.status === 'blocked' || result.status === 'unauthorized') {
        blockedTools.push(result.toolId);
      } else if (result.status === 'pending_confirmation') {
        pendingConfirmationTools.push(result.toolId);
      } else if (result.status === 'ready') {
        readyTools.push(result.toolId);
      }
    }
  }

  let resolutionStatus: RegistryResolution['status'] = 'resolved';
  
  if (missingTools.length > 0 || blockedTools.length > 0) {
    resolutionStatus = readyTools.length > 0 ? 'partial' : 'failed';
  } else if (pendingConfirmationTools.length > 0) {
    // Se precisa de confirmação, consideramos partial até que a Policy/UI libere
    resolutionStatus = 'partial';
  }

  return {
    planId: plan.id,
    status: resolutionStatus,
    results,
    missingTools,
    blockedTools,
    pendingConfirmationTools,
    readyTools,
  };
}
