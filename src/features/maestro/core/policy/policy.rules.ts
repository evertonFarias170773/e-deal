import type { PolicyRequest } from './policy.types';
import type { PolicyDecision } from './policy.result';

export function evaluateExecutionModeRule(request: PolicyRequest): PolicyDecision {
  const mode = request.executionMode || 'blocked';
  
  switch (mode) {
    case 'auto':
      return {
        status: 'allowed',
        reason: 'O modo de execução permite automação plena sem fricção.',
        requiresConfirmation: false,
        requiresPermission: [],
        canExecute: true,
        auditLevel: 'low',
        warnings: [],
      };
    case 'confirm':
      return {
        status: 'requires_confirmation',
        reason: 'Segurança: Ação sensível exige confirmação explícita.',
        requiresConfirmation: true,
        requiresPermission: [],
        canExecute: false, // Só ficará true caso o usuário aprove
        auditLevel: 'medium',
        warnings: ['Aguardando intervenção humana (UI) para prosseguir.'],
      };
    case 'manual':
      return {
        status: 'blocked',
        reason: 'Operação instrucional: deve ser realizada manualmente pelo usuário no ERP.',
        requiresConfirmation: false,
        requiresPermission: [],
        canExecute: false,
        auditLevel: 'low',
        warnings: ['Execução automática indisponível para esta ferramenta.'],
      };
    case 'blocked':
    default:
      return {
        status: 'denied',
        reason: 'Bloqueio administrativo: Execução negada por política.',
        requiresConfirmation: false,
        requiresPermission: ['admin'],
        canExecute: false,
        auditLevel: 'high',
        warnings: ['Tentativa de acessar rota restrita ou em manutenção.'],
      };
  }
}
