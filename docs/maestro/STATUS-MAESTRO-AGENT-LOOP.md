# STATUS-MAESTRO-AGENT-LOOP.md

Versão: 1.0
Status: Oficial — fonte única do estado atual do Maestro V2
Última atualização: 26/07/2026
Projeto: Vibe

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

## 2.1 Manual de uso e consulta por pedido (02/10/2026)

O catálogo real hoje tem **31 tools**: as 29 que já existiam (28 de leitura e a
escrita `salvar_cotacao_como_proposta`, única exceção de escrita por decisão do
dono em 01/10/2026) e as duas abaixo. O Maestro só orienta e mostra dados.

- **`consultar_manual`** — lê páginas de `docs/manual/` (manual de uso, mantido
  fora do Maestro: uma página por tela, atualizada no mesmo commit de cada
  mudança visível; regra no `AGENTS.md`). O índice das páginas (título, onde
  fica, o que cobre, páginas vizinhas) entra no prompt a cada turno; a tool
  devolve o texto inteiro das páginas pedidas e o retrato de quem pergunta
  (perfil e permissões pelos rótulos da tela de Perfis). Sem permissão, o
  Maestro explica o passo e diz a quem pedir.
- **`consultar_pedido`** — situação real de um pedido pelo número, sem cliente
  ativo, em partes: `situacao`, `cobrancas`, `titulos`, `nota_fiscal`,
  `producao`, `expedicao`, `tarefas`. Duas travas no servidor:
  1. **Escopo por vendedor**: vendedor sem `propostas.view_all` só consulta o
     pedido em que ele é o vendedor (`usuarios.meu_vendedor || nome_usuario` ×
     `propostas.vendedor`). Pedido de outro devolve recusa sem nenhum dado. A
     trava fica na tool porque a RLS de `propostas` é aberta. Quem não vende
     (Produção, Designer, Expedição) é recortado só pela permissão de cada parte.
  2. **Permissão por parte**, igual à da tela: `situacao` → `propostas.view*`;
     `cobrancas` → `cobrancas.view`/`cobrancas.create`/`conferencia.view`;
     `titulos` → `contas_receber.view`; `nota_fiscal` → `fiscal.view`;
     `producao` → `pedidos.view`; `expedicao` → `expedicao.view`;
     `tarefas` → `tarefas.participar`. Administrador e super admin passam, como
     no `PermissionGuard`.
  Nunca saem: linha digitável, código de barras, nosso número, link de boleto,
  chave de NF-e, CPF/CNPJ. Totais e contagens saem prontos.

Travas contra passo a passo inventado (todas no servidor, depois do modelo):

| Trava | O que barra | Efeito |
|---|---|---|
| Passos sem manual | Resposta ensina a usar uma tela e nenhuma página foi lida no turno | Uma rodada de correção; persistindo, a resposta vira o texto fixo "ainda não tenho esse passo a passo" |
| Nome fora da página | Menu, aba ou botão que não está em nenhuma página lida | Uma rodada de correção; persistindo, aviso no fim com os nomes |
| Conferência do assunto | Página lida ensina OUTRA tarefa (só palavras em comum) | Chamada curta ao modelo; "outra tarefa" troca a resposta pelo texto fixo |

A auditoria (`maestro_acoes.payload`) passou a registrar `consultas` (qual
página do manual, qual pedido, quais partes e se saiu dado), `manual_lido`,
`conferencia_do_assunto`, `correcoes_do_manual` e `trava_do_manual`.

Arquivos: `maestro-agent-manual.server.ts`, `maestro-agent-pedido.server.ts`,
`maestro-agent-acesso.server.ts`, `maestro-agent-trava-manual.ts`,
`maestro-agent-conferencia.server.ts`. Teste sem banco e sem modelo:
`scripts/testes/maestro-manual-e-pedido.test.mts`. Em produção os `.md` do
manual chegam à função por `outputFileTracingIncludes` no `next.config.ts`.

Limites conhecidos: (a) o Maestro lê só a página que escolheu; quando o fluxo
continua em outra tela, ele cita a tela mas nem sempre detalha os passos de lá;
(b) as consultas por cliente (`propostas_cliente`, `detalhe_proposta`,
`boletos_cliente`...) continuam sem o escopo por vendedor.

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
- escrita: NENHUMA tool de escrita registrada; regras futuras na matriz.

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
| Leitura (23 tools) | ✅ implementada e validada em localhost |
| Auditoria e persistência | ✅ aplicadas; flags ligadas em localhost |
| Rollout equipe | ⏳ criar as flags no ambiente de deploy |
| Escrita assistida (Trilha B) | Matriz aprovada (26/07); implementação da B1 (`salvar_cotacao_como_proposta`) aguardando autorização explícita |

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
