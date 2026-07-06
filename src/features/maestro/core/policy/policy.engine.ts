import type { PolicyRequest } from './policy.types';
import type { PolicyDecision } from './policy.result';
import { evaluateExecutionModeRule } from './policy.rules';

export function evaluatePolicy(request: PolicyRequest): PolicyDecision {
  // O Policy Engine atua como um agregador de regras.
  // Nesta Release 0.7, ele foca em vetar a ferramenta baseado no seu modo de execução.
  // Futuramente, empilharemos validações de permissões reais (roles, JWT, RLS).

  const decision = evaluateExecutionModeRule(request);

  return decision;
}