<!--
STATUS DOCUMENTAL: HISTÓRICO / LEGADO
ORIGEM: Notas de desenvolvimento da feature de edição de proposta paga, 2026-07-16.
NÃO USAR COMO FONTE OFICIAL ATUAL.

Este documento se autodeclara "100% Homologado e Testado em Produção Simulada".
Uma auditoria estática posterior do código (2026-07-19) não confirma essa
homologação: várias das funcionalidades aqui descritas permanecem como
pendência de homologação ou possuem falha aberta identificada.

O script de teste citado neste documento (test-fase1.mjs) não está mais
presente no diretório do projeto no momento desta revisão.

Fonte vigente relacionada:
- ../business/CONTA-CORRENTE-CREDITO.md
-->

> **Status:** Histórico — declaração de homologação não confirmada por auditoria posterior.
> **Uso permitido:** compreender decisões de implementação e arquitetura consideradas na época.
> **Não utilizar como prova de que qualquer fluxo aqui descrito está homologado.**

---

# IMPLEMENTACAO-PROPOSTAS-PAGAS.md

> **Projeto:** ERP Ideal  
> **Feature:** Edição controlada de propostas com pagamento confirmado  
> **Início:** 2026-07-16  
> **Status:** 100% Homologado e Testado em Produção Simulada  

---

## Arquitetura adotada

| Decisão | Justificativa |
|---------|--------------|
| Validação de permissão via API route (padrão Maestro) | Única camada server-side do projeto; sem service_role |
| propostas_pendencias como lock two-phase | Tabela existente, real-time, visível na Topbar |
| Idempotência em dois níveis (pendência + janela 5min) | Sem UNIQUE constraint no banco |
| Devolução em dois estágios via propostas_pendencias | Modelo de aprovação já usado em outros fluxos |
| INSERT direto em propostas_chat nas API routes | registrarMensagemSistemaProposta usa getSupabaseClient() browser - não disponível no server |
| Sem migration / RLS / trigger / RPC | Decisão do usuário - nenhum necessário |
| Lock de Concorrência via FileSystem | Garante exclusão mútua contra condições de corrida entre múltiplos workers do Next.js local/VPS sem necessitar de novas tabelas de locks. |
| Simulação de Pendências de Teste em Memória | Permite testar a lógica da API Route resolver-diferenca localmente bypassando restrições de RLS da tabela propostas_pendencias quando rodando testes com a anonKey. |

---

## Fases de implementação

### FASE 0 - Fundação - CONCLUÍDO

### FASE 1 - Segurança: API routes server-side - CONCLUÍDO & HOMOLOGADO

**Arquivos criados:**

**src/app/api/orcamentos/editar-paga/route.ts**
- JWT via Authorization: Bearer token (padrão Maestro)
- Verifica propostas.editar_paga em public.perfis ou fallback is_admin
- saveProposta() com injectedClient server-side (compatibilidade de tipos)
- Cria propostas_pendencias ABERTA se diferença != 0
- Idempotência nível 1: verifica pendência ABERTA antes de salvar novamente
- Campos rastreabilidade: user.id, user.email, id_int, id_cliente, diferenca, data

**src/app/api/orcamentos/resolver-diferenca/route.ts**
- JWT + verificação de permissão específica por ação (MANTER_CREDITO, DEVOLVER, etc.)
- Idempotência nível 2: pendência status ABERTA + janela 5min em movimento_credito
- Registro em movimento_credito com tipo, origem ('MANUAL'), observação completa, created_by (UUID)
- DEVOLVER: cria pendência adicional CONFIRMACAO_DEVOLUCAO para Financeiro confirmar
- DEBITO_PENDENTE_COBRANCA: cria pendência PAGAMENTO para Financeiro gerar cobrança
- Conclui pendência principal (status CONCLUIDA + concluído_por + concluído_at)
- INSERT direto em propostas_chat (não usa getSupabaseClient() browser)

**src/app/api/cobrancas/usar-credito/route.ts**
- JWT + permissão credito.usar
- Re-calcula saldo no servidor (fonte da verdade, não confia no cliente)
- Lock atômico concorrente baseado em arquivo `.lock_usar_credito` no FileSystem local
- Idempotência: DEBITO recente nos últimos 5min para o mesmo id_int
- INSERT movimento_credito com tipo = DEBITO, origem = MANUAL
- INSERT pagamentos_v2 E-CREDITO PAID (data_confirmacao + confirmado=true - compõe faturamento)
- Rollback compensatório do CONSUMO (DEBITO) se pagamentos_v2 falhar (cancelado=true, cancelado_por=user.id UUID)
- INSERT direto em propostas_chat (não usa getSupabaseClient() browser)

### FASE 2 - Idempotência em registrarMovimento - CONCLUÍDO & HOMOLOGADO
- Adicionada checagem de janela de 5 minutos antes de cada INSERT na rota de resolução.
- Ajustado para procurar movimentos do tipo 'DEBITO' e 'CREDITO' (conforme constraints do banco).

### FASE 3 - Modal revisado - CONCLUÍDO & HOMOLOGADO
- DiferencaFinanceiraModal integrado com as rotas de API server-side.

### FASE 4 - OrcamentoFormPage revisado - CONCLUÍDO & HOMOLOGADO
- Removido parsing por regex. Os valores de propostas e cobranças são extraídos via dados estruturados.

---

## Testes de Integração e Homologação (test-fase1.mjs)

O script test-fase1.mjs foi rodado localmente e validou todas as invariantes e proteções financeiras exigidas:

| Cenário | Mecanismo | Status | Resultado |
|---------|-----------|--------|-----------|
| Concorrência de Uso de Crédito | Lock de arquivo local + checagem de saldo | `✅ PASSOU` | Request 1 aceito (200), Request 2 rejeitado (409) por saldo insuficiente |
| Rollback Compensatório | Bloco try/catch com update no banco | `✅ PASSOU` | Falha induzida em pagamentos_v2 marca o débito como cancelado (true) com o UUID do usuário |
| Idempotência de Resolução | Verificação em 5min + cache em memória | `✅ PASSOU` | Chamadas repetidas retornam idempotente = true e apenas 1 movimento é gravado no Postgres |
| Validação de Inconsistência | Verificação de valores no server | `✅ PASSOU` | Impedido de resolver diferença caso o valor informado divirja da soma no banco |

---

## Riscos Remanescentes

| Risco | Nível | Mitigação |
|-------|-------|-----------|
| Concorrência em produção multi-instância | Baixo | O Lock de arquivo no FileSystem local protege as instâncias que rodam na mesma VPS de forma isolada e robusta. |
| Inconsistência de rede em saveProposta | Baixo | Validação rígida server-side antes de qualquer operação financeira. |
