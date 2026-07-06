import type { SpecialistType } from '../../types';

export type PlanStatus = 'planned' | 'waiting' | 'running' | 'completed' | 'blocked';
export type StepStatus = 'planned' | 'waiting' | 'running' | 'completed' | 'blocked';
export type StepType = 'identify' | 'search' | 'validate' | 'calculate' | 'consult' | 'generate' | 'confirm' | 'respond';
export type ExecutionMode = 'auto' | 'confirm' | 'manual' | 'blocked';

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  type: StepType;
  executionMode: ExecutionMode;
  estimatedTool?: string;
  estimatedSpecialist?: SpecialistType;
  canExecute: boolean;
  dependsOn: string[];
}

export interface ExecutionPlan {
  id: string;
  title: string;
  summary: string;
  status: PlanStatus;
  confidence: 'high' | 'medium' | 'low';
  estimatedSteps: number;
  estimatedSpecialist: SpecialistType;
  steps: PlanStep[];
  
  // Future properties
  nextAction?: string;
  requiredTools?: string[];
  requiredPermissions?: string[];
  requiredContext?: string[];
}
