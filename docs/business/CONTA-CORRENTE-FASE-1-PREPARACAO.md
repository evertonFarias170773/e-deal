# CONTA-CORRENTE-FASE-1-PREPARACAO.md

Versão: 1.0
Status: **PREPARADA — NÃO APLICADA**
Última atualização: 21/07/2026
Projeto: Vibe

---

# Fase 1 — Reformulação da Conta Corrente (Pendências Financeiras)

Este documento descreve **exclusivamente os arquivos preparados** da Fase 1 (estrutura de banco + RPCs). **Nada foi aplicado** no banco: não houve `supabase db push`, SQL Editor, migration local/remota, limpeza de dados ou alteração em produção.

Arquivo de migration preparado: `supabase/migrations/20260721_conta_corrente_fase1.sql`.

A especificação conceitual aprovada está no plano de reformulação. Este documento é a referência técnica da migration.

---

## 1. Objetivo e limites
A Conta Corrente representa **apenas pendências financeiras de diferença surgidas após uma proposta já paga** (frete, produto, serviço, diferença a favor do cliente ou da empresa). É distinta de Contas a Receber (`public.boletos`) e de pagamentos (`public.pagamentos_v2`). Pendência **não** vira boleto automático e **não** bloqueia novos pedidos.

- Saldo operacional: `conta_corrente_pendencias.valor_saldo`.
- Razão imutável (auditoria/reconciliação): `public.movimento_credito` (append-only).
- **Sem** tabela `conta_corrente_utilizacoes`. **`propostas_pendencias` fora do domínio financeiro.**
- v1: `id_int` obrigatório; **sem ajuste avulso** sem proposta.

## 2. Estruturas criadas/alteradas
- **Nova:** `public.conta_corrente_pendencias` (estado da pendência).
- **Aditivo em `public.movimento_credito`:** `id_pendencia`, `tipo_evento`, `id_int_origem`, `id_int_destino`, `id_pagamento_destino`, `id_movimento_ref`, `motivo_evento` (todas NULLABLE; registros legados intactos; `cancelado*` congelados; tipo de `valor` legado **não** alterado nesta fase).
- **Aditivo em `public.pagamentos_v2`:** `id_pendencia`, `valor_pendencia numeric(12,2)`, `reserva_estado`, `chave_reserva` (somente aditivo; nenhum fluxo existente de pagamentos_v2/boletos alterado).
- **RPCs:** `cc_abrir_pendencia`, `cc_usar_pendencia`, `cc_encerrar_pendencia` + helpers `cc__assert_permissao`, `cc__status`, `cc__timeline`, `cc__valor_pago`.

## 3. Estados e eventos
- **Estados (pendência):** `ABERTA` → `PARCIALMENTE_RESOLVIDA` → `RESOLVIDA` · `CANCELADA`.
- **Eventos na razão (`tipo_evento`):** `ABERTURA`, `USO_PEDIDO`, `DEVOLUCAO`, `BONIFICACAO`, `BAIXA`, `CANCELAMENTO`, `ESTORNO`.
- **Reserva de débito (operacional, sem razão):** `RESERVA_ATIVA` → `RESERVA_CONFIRMADA` (recebido) | `RESERVA_LIBERADA` (falha/cancelamento). Só a **confirmação** grava `USO_PEDIDO` na razão.

## 4. Contratos das RPCs (SECURITY DEFINER, search_path fixo, valida `auth.uid()` e permissão)
| RPC | Permissão | Resumo transacional |
|---|---|---|
| `cc_abrir_pendencia(id_int,id_cliente,chave_evento,motivo,total_soberano,obs)` | `propostas.editar_paga` | Idempotente por `chave_evento`; recomputa `valor_pago` no servidor; recalcula diferença = `total_soberano − pago` (**não lê `propostas.valor_total`**); sob lock ajusta a pendência aberta, inverte direção (encerra+abre) ou cria nova; grava `ABERTURA` + timeline. |
| `cc_usar_pendencia(id_pendencia,valor,modo,id_int_destino,id_pagamento,chave_reserva,obs)` | `credito.usar` | `FOR UPDATE`; valida saldo e mínimo R$ 0,01 sem resíduo. `CREDITO_IMEDIATO`: consome e grava `USO_PEDIDO`. `RESERVA_DEBITO`: move saldo→reservado, marca a cobrança (`RESERVA_ATIVA`), **sem** razão; idempotente por `chave_reserva`. |
| `cc_encerrar_pendencia(id_pendencia,modo,valor,id_movimento_ref,chave_reserva,motivo,obs)` | por modo (ver abaixo) | `CONFIRMAR_RESERVA`/`LIBERAR_RESERVA` localizam a reserva exata por `chave_reserva`; `DEVOLUCAO`/`BONIFICACAO`/`BAIXA` consomem saldo; `CANCELAMENTO` anula saldo livre; `ESTORNO` insere compensatório e reabre saldo. |

Permissões por modo de encerramento: `CONFIRMAR/LIBERAR` → `credito.usar`; `DEVOLUCAO` → `financeiro.devolver`; `BONIFICACAO` → `financeiro.bonificar`; `BAIXA`/`CANCELAMENTO` → `financeiro.resolver_credito`; **`ESTORNO` → somente admin/superadmin (v1)**.

## 5. Fluxo de reserva → confirmação → liberação (débito em nova cobrança)
1. A rota cria a cobrança em `pagamentos_v2` (status `A_RECEBER`) e chama `cc_usar_pendencia(RESERVA_DEBITO)` → **commit** (nenhuma transação aberta durante integração externa).
2. Integração externa gera PIX/boleto contra a cobrança já persistida (retry idempotente pelo id da cobrança).
3. Recebimento → `cc_encerrar_pendencia(CONFIRMAR_RESERVA)` (grava `USO_PEDIDO`). Falha/cancelamento → `cc_encerrar_pendencia(LIBERAR_RESERVA)` (devolve ao saldo).

## 6. Constraints e índices
- `conta_corrente_pendencias`: CHECKs de `direcao`/`motivo`/`status`, `valor_original >= 0.01`, `valor_saldo`/`valor_reservado` = 0 ou ≥ 0,01, `valor_saldo + valor_reservado <= valor_original`; `UNIQUE(chave_evento)`; `UNIQUE(id_int) WHERE status IN ('ABERTA','PARCIALMENTE_RESOLVIDA')`.
- `movimento_credito`: `CHECK tipo_evento`; `UNIQUE(id_movimento_ref) WHERE tipo_evento='ESTORNO'`; trigger append-only (bloqueia UPDATE/DELETE).
- `pagamentos_v2`: `UNIQUE(chave_reserva)`; `UNIQUE(id_pendencia) WHERE reserva_estado='RESERVA_ATIVA'` (uma reserva ativa por pendência).

## 7. Invariante e reconciliação
`valor_resolvido = valor_original − valor_saldo − valor_reservado` (derivado). Após `ESTORNO`, a RPC devolve o valor ao `valor_saldo` e grava o compensatório → os dois lados caem juntos. Reconciliação read-only (só sinaliza):
`valor_reservado == Σ pagamentos_v2.valor_pendencia (RESERVA_ATIVA)` e
`valor_resolvido == Σ mc(USO_PEDIDO,DEVOLUCAO,BONIFICACAO,BAIXA) − Σ mc(ESTORNO)`.

## 8. Segurança
- Todas as RPCs: `SECURITY DEFINER` com `SET search_path = public, pg_temp`, validação de `auth.uid()` e de permissão no banco.
- Escrita direta nas novas estruturas bloqueada; mudança de saldo **somente** via RPC.
- `movimento_credito`: revogada escrita direta de `anon`/`authenticated`, removida a policy permissiva `geral`, leitura mantida; append-only por trigger; **nenhum DELETE nem alteração de registros legados** `cancelado=true/false`.
- RLS de leitura da nova tabela conforme escopo oficial (leitura autenticada; escopo fino permanece na aplicação, como em `propostas_pendencias`).

## 9. Pré-voo obrigatório (antes de aplicar)
Rodar os SELECTs do topo da migration (`supabase/migrations/20260721_conta_corrente_fase1.sql`) no SQL Editor com privilégio pleno: triggers/funções anexados às tabelas do cálculo; tipos/precisão monetários; contagem real de `valor_total` nulo sem RLS; estados de `pagamentos_v2`; coluna real de item cancelado em `produtos_proposta`; políticas/grants atuais.

## 10. Acoplamento e riscos
- **Acoplamento Fase 2 (crítico):** a Seção E da migration (revogar escrita direta + append-only em `movimento_credito`) **quebra** as rotas legadas (`usar-credito`, `resolver-diferenca`, `ajuste-credito`, `estorno-credito`, `confirmar`, `pagamento-combinado`) que fazem INSERT/UPDATE direto. **Aplicar somente junto ao refactor dessas rotas para as RPCs.**
- **`produtos_proposta` sem `status_item` no dump:** o "total soberano" é calculado no servidor (`getPropostaDetailById`, que exclui itens cancelados) e **passado** à RPC; confirmar a coluna real no pré-voo.
- **Tipos legados:** `movimento_credito.valor` é `numeric` sem escala e `propostas.valor_total` é `double precision`; **não** alterados nesta fase. Padronização de `movimento_credito.valor` para `numeric(12,2)` fica para a reinicialização (fase de limpeza separada).
- **Limpeza de dados de teste:** **não** faz parte desta migration; é etapa separada e autorizada (backup + zeragem), que fará `DROP TRIGGER append-only → DELETE → recriar`.

## 11. Documentação relacionada
- `./CONTA-CORRENTE-CREDITO.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `./CHECKOUT-PAGAMENTOS.md`
- `../technical/PERFIS-PERMISSOES.md`

---

# Fonte da Verdade
Enquanto o status deste documento for **PREPARADA — NÃO APLICADA**, nenhuma capacidade aqui descrita deve ser considerada disponível. A aplicação exige o pré-voo (Seção 9) e o acoplamento com a Fase 2 (Seção 10).
