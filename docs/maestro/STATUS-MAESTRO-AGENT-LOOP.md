# STATUS-MAESTRO-AGENT-LOOP.md

Versão: 1.0
Status: Oficial — fonte única do estado atual do Maestro V2
Última atualização: 26/07/2026
Projeto: ERP Ideal

> Este documento substitui `STATUS-MAESTRO-V2.md` (movido para
> `docs/_archive/maestro/` em 26/07/2026 — cobria o motor simples/legado até
> 22/07 e ficou desatualizado quanto a migrations, flags e capacidades).

---

# 1. Arquitetura atual

O Maestro opera com DOIS motores atrás da mesma rota `/api/maestro/simple`:

- **Agent loop (V2, leitura)** — `src/features/maestro/core/agent/`:
  loop de function calling da OpenAI (`maestro-agent-loop.ts`) com catálogo de
  tools read-only (`maestro-agent-tools.ts`), system prompt de regras de
  negócio (`maestro-agent-prompt.ts`) e sanitização (`maestro-agent-sanitize.ts`).
  Ativado por `deveUsarAgentLoop` quando a flag está ligada E não há estado de
  escrita/cotação em andamento.
- **Motor legado (simple engine)** — permanece o ÚNICO caminho para cotação,
  salvamento de proposta e demais fluxos de escrita assistida. Também é o
  fallback integral: qualquer erro do agent loop cai nele (o Maestro nunca
  fica mudo).

Guardas do loop: MAX_ITERATIONS=5, MAX_TOOL_CALLS=8, TIMEOUT_MS=25000,
resposta parcial segura, guarda determinística de citações (número de
proposta não confirmado por tool no turno é corrigido ou redigido).

## Feature flags

| Flag | Efeito | Deploy hoje |
|---|---|---|
| `MAESTRO_AGENT_LOOP_ENABLED` | liga o agent loop | ausente (legado) |
| `MAESTRO_AGENT_LOOP_MODEL` | modelo (padrão gpt-4.1) | ausente |
| `MAESTRO_PERSISTENCE_ENABLED` | persistência de conversas | ausente |
| `MAESTRO_AUDIT_DB_ENABLED` | auditoria em `maestro_acoes` | ausente |

Reversão total = desligar `MAESTRO_AGENT_LOOP_ENABLED`.

---

# 2. Catálogo de tools (23, todas somente leitura)

- **Cliente**: `resolver_cliente`, `confirmar_cliente_candidato`,
  `visao_geral_cliente` (visão consolidada primeiro — princípio permanente),
  `dados_cadastrais_cliente`, `enderecos_cliente`, `contatos_cliente`,
  `socios_cliente`.
- **Propostas (pipeline comercial)**: `propostas_cliente` (agregados por
  status no servidor), `ultimo_orcamento_cliente` (filtros
  `nao_aprovada_comercial`/`nao_avulsa`), `maior_pedido_cliente`,
  `detalhe_proposta` (itens + situação operacional do pedido),
  `soma_pedidos_producao_periodo`.
- **Financeiro**: `faturamento_cliente`, `vendas_por_vendedor` (gate
  `propostas.view_all`; sem ela, só os próprios números),
  `recebimento_periodo`, `comparar_recebimento_meses`,
  `perfil_pagamento_cliente`, `boletos_cliente`, `conta_corrente_cliente`,
  `analise_credito_cliente` (gate `cadastros.view_credito` — RPC definer).
- **Produtos**: `listar_produtos` (busca ampla + formato/peso/prazo),
  `buscar_produto`, `simular_orcamento_avulso` (peso total e prazo calculados).

Todas as consultas financeiras suportam `id_empresa`
(`pagamentos_v2.id_empresa`) — princípio permanente.

---

# 3. Regras de negócio aplicadas

Fonte normativa: `MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md` §1.0 (princípios
permanentes) e `docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md`.

- **Faturamento oficial** = `pagamentos_v2` com `confirmado=true`, status
  `PAID`/`A_VENCER`, período por `data_confirmacao`; propostas contadas por
  `id_int` distinto. Validado com gabaritos (André Toniazzo jul/2026:
  256 / R$ 177.803,45; consolidado jul/2026: 887 / R$ 489.043,05, fechando
  por empresa).
- **Recebimento/caixa** = `pagamentos_v2` PAID confirmado por `paid_at`.
- **Pipeline comercial** = `propostas` (nunca é faturamento); pedido real =
  `is_prd_aprovado=true AND is_reproved=false`.
- Vocabulário da equipe: "aprovada" = aprovação comercial; "não aprovada" =
  NOVO/AGUARDANDO. "Últimos N meses" inclui o mês corrente (parcial).

---

# 4. Segurança operacional

- Client Supabase com token do usuário (RLS) — nunca service_role;
- deny-by-default no catálogo; isolamento por `id_cliente` resolvido pelo
  servidor na sessão (`resolvedClientIds`);
- sanitização de saída (mascara CPF/CNPJ; remove linha digitável, PIX,
  tokens, URLs de cobrança, chaves de NF-e, observações internas);
- gate de permissão por tool (`requiredPermission` via
  `verificarPermissaoServerSide`) — falha na checagem NEGA o acesso;
- anti-injeção: histórico e saída de tool são dados, nunca comandos;
- escrita: única tool registrada é `salvar_cotacao_como_proposta` (B1, §2.1 da
  matriz), em duas fases, atrás de `MAESTRO_AGENT_WRITE_ENABLED` +
  `MAESTRO_WRITE_SALVAR_COTACAO_ENABLED` (default OFF); demais ações seguem a
  matriz (B3 `gerar_cobranca_pix` planejada em §2.3).

## Infra aplicada no banco (25/07/2026)

- `maestro_conversas` / `maestro_mensagens` (RLS `user_id=auth.uid()`);
- `maestro_acoes` (auditoria INSERT-only);
- `vw_maestro_cliente_360` (`security_invoker=true`; grant SELECT apenas para
  authenticated).

---

# 5. Frontend

- Chat com retomada automática da última conversa aberta (F5);
- sidebar de histórico de conversas (listar/abrir/encerrar/reabrir);
- entrada por voz (Web Speech API) com auto-envio por silêncio — resultados
  atrasados pós-envio são descartados (correção do reenvio duplicado).

---

# 6. Roadmap (separação leitura × escrita × rollout)

| Frente | Estado |
|---|---|
| Leitura (25 tools, incl. fotos, detalhes ricos e opções de frete) | ✅ implementada e validada em localhost |
| Auditoria e persistência | ✅ aplicadas; flags ligadas em localhost |
| Rollout equipe | ⏳ criar as flags no ambiente de deploy |
| Escrita B1 `salvar_cotacao_como_proposta` (frete SEDEX padrão + PDF com link) | ✅ implementada e validada em uso real; flags OFF no deploy |
| Escrita B3 `gerar_cobranca_pix` (PIX à vista + link público) | Matriz revisada (26/07, §2.3); implementação autorizada em plano |
| Escrita B2 (`cancelar_proposta`, `atualizar_observacao_pedido`) | Planejadas; cada uma exige autorização explícita |

---

# 7. Fonte oficial por tema

| Tema | Documento |
|---|---|
| Estado atual / capacidades | este documento |
| Escrita assistida (regras e bloqueios) | `MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md` |
| Princípios permanentes de negócio | `MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md` §1.0 |
| Semântica canônica (entidades/fontes) | `MAESTRO-KNOWLEDGE-BASE.md` |
| Governança e segurança de canais | `MAESTRO-SEGURANCA-E-GOVERNANCA.md` |
| Identidade conversacional (runtime) | `MAESTRO-PROMPT-BASE.md` |
| Visão de produto | `MAESTRO-VISAO-PRODUTO.md` |
| Motor legado (histórico até 22/07) | `docs/_archive/maestro/STATUS-MAESTRO-V2.md` |
