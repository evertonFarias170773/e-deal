import type { MaestroSpecialist, SpecialistCapabilities, SpecialistExample } from '../specialist.types';
import { ComercialCapabilities } from './comercial.capabilities';
import { ComercialRules } from './comercial.rules';
import { ComercialGuardrails } from './comercial.guardrails';
import { ComercialPrompts } from './comercial.prompts';
import { ComercialExamples } from './comercial.examples';

export class ComercialSpecialist implements MaestroSpecialist {
  id = 'comercial';
  name = 'Especialista Comercial';
  description = 'Especialista focado em vendas, relacionamento com o cliente, limites de crédito e propostas.';

  getCapabilities(): SpecialistCapabilities {
    return ComercialCapabilities;
  }

  getRules(): string[] {
    return ComercialRules;
  }

  getGuardrails(): string[] {
    return ComercialGuardrails;
  }

  getPrompts(): string[] {
    return ComercialPrompts;
  }

  getExamples(): SpecialistExample[] {
    return ComercialExamples;
  }
}
