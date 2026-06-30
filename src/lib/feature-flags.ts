/**
 * Centralizador de Feature Flags do ERP Ideal.
 * As flags podem ser definidas via .env.local para ativação sem deploy,
 * mas por padrão nascem desligadas (false) para garantir a integridade do sistema atual.
 * Se precisar usar no frontend, deve utilizar NEXT_PUBLIC_.
 */

export const featureFlags = {
  // Ativa a nova leitura do status das propostas nas listagens e componentes visuais (Fase 3)
  STATUS_PROPOSTAS_V2: process.env.NEXT_PUBLIC_FEATURE_STATUS_PROPOSTAS_V2 === "true",

  // Ativa a capacidade de criar Múltiplas OS para a mesma proposta (Fase 2/5)
  MULTI_OS_V2: process.env.NEXT_PUBLIC_FEATURE_MULTI_OS_V2 === "true",
};
