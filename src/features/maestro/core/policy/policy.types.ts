import type { ConversationContext, SpecialistType } from '../../types';
import type { ExecutionPlan, PlanStep, ExecutionMode } from '../planner/planner.types';
import type { RegistryResolution, RegistryResult } from '../registry/registry.result';
import type { ToolDefinition } from '../registry/registry.types';
import type { ToolResult } from '../tools/tools.types';

export type AuditLevel = 'low' | 'medium' | 'high' | 'critical';
export type PolicyDecisionStatus = 'allowed' | 'requires_confirmation' | 'blocked' | 'denied';

export interface PolicyRequest {
  conversationContext: ConversationContext;
  executionPlan?: ExecutionPlan;
  currentStep?: PlanStep;
  registryResolution?: RegistryResolution;
  registryResult?: RegistryResult;
  toolDefinition?: ToolDefinition;
  toolResult?: ToolResult;
  executionMode?: ExecutionMode;
  specialist?: SpecialistType;
  domain?: string;
}
