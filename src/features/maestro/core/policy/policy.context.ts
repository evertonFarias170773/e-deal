import type { ConversationContext } from '../../types';
import type { PolicyRequest } from './policy.types';
import type { PlanStep } from '../planner/planner.types';
import type { RegistryResult } from '../registry/registry.result';

export function buildPolicyRequest(
  context: ConversationContext,
  step: PlanStep,
  registryResult: RegistryResult
): PolicyRequest {
  return {
    conversationContext: context,
    executionPlan: context.activePlan,
    currentStep: step,
    registryResolution: context.registryResolution,
    registryResult,
    toolDefinition: registryResult.tool,
    executionMode: registryResult.executionMode || step.executionMode,
    specialist: registryResult.tool?.specialist || step.estimatedSpecialist,
    domain: registryResult.tool?.domain || context.domain,
  };
}
