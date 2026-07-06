import type { PlanStep, StepType, ExecutionMode } from './planner.types';
import type { SpecialistType } from '../../types';

interface StepOptions {
  title: string;
  description: string;
  type: StepType;
  executionMode: ExecutionMode;
  estimatedSpecialist?: SpecialistType;
  estimatedTool?: string;
  dependsOn?: string[];
}

export function createStep(id: string, options: StepOptions): PlanStep {
  return {
    id,
    title: options.title,
    description: options.description,
    status: 'planned',
    type: options.type,
    executionMode: options.executionMode,
    estimatedSpecialist: options.estimatedSpecialist,
    estimatedTool: options.estimatedTool,
    canExecute: options.executionMode === 'auto' || options.executionMode === 'confirm',
    dependsOn: options.dependsOn || [],
  };
}
