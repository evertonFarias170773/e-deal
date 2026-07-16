# Changelog

Todas as alterações notáveis neste projeto serão documentadas neste arquivo.

O formato baseia-se no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [Não Lançado] - 2026-07-16

### Saneamento do Build Global (Fase 2.5)
- **Correção:** Tipagens legadas e assinaturas de métodos do módulo Maestro (`maestro-orcamento-engine.ts`, `maestro-simple-engine.ts`, `maestro-v2-router.ts`) foram atualizadas de acordo com seus contratos reais, resolvendo 100% dos erros de TypeScript estruturais.
- **Correção:** Mocks e scripts de teste locais (`test_maestro_confirm_candidate.ts`, `test_maestro_veppo_address.ts`, `test_reproduce_divergence.ts`, `test-interceptor.ts`, `test-router.ts`, `test-maestro-frete-avulso.ts`) foram corrigidos para alinhar-se à interface `ConversationContext` atualizada e às assinaturas vigentes.
- **Garantia:** Zero alterações foram feitas nos fluxos financeiros e de propostas para satisfazer o build. As inconsistências identificadas pertenciam puramente a código subutilizado/legado.
- **Status:** Build (`npm run build`) e verificador estático (`npx tsc --noEmit`) operam com zero falhas, desbloqueando a liberação para Produção.

### Adicionado (Fase 2 - Edição de Propostas Pagas e Créditos)
- **Nova Funcionalidade:** Implementação completa da edição de propostas que já possuíam pagamentos confirmados.
- **Financeiro:** Criada infraestrutura de "Crédito" e "Débito" de clientes, incluindo a persistência segura via `movimento_credito`.
- **Financeiro:** Suporte a utilização de crédito prévio (`saldo`) para abater total ou parcialmente novos débitos em pendências financeiras.
- **Workflow:** Janelas de pendências agora tratam as opções "Manter como Crédito" (gera crédito automático) e "Solicitar Devolução" (registra pendência financeira a ser processada pelo backoffice).
- **Segurança e Idempotência:** Prevenção de dupla inserção por *debounce/lock* temporal e janelas de tolerância, mitigando falhas na ausência de suporte transacional estrito de múltiplas tabelas.

### Adicionado (Fase 1 - Divergências Financeiras)
- **Arquitetura:** Inserção do modelo de resolução de pendências usando a tabela `propostas_pendencias`.
- **Workflow:** Detectores de divergência de valor na edição de propostas e roteamento de pendência (diferença maior que o pago vs menor que o pago).
- **Financeiro:** Cálculo consolidado da saúde financeira da proposta consultando a base de `pagamentos_v2`.
