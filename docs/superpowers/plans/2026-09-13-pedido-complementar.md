# Plano de implementação — Pedido complementar

> **Para agentes executores:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`, uma etapa por rodada. Etapas usam checkbox (`- [ ]`) para acompanhamento.

**Spec:** embutida nas seções 0–9 deste documento; a regra de negócio "oficial" nasce na etapa E0 em `docs/business/PEDIDO-COMPLEMENTAR.md`.
**Data:** 13/09/2026
**Branch:** `erp-ideal-preview` (branch única — cada etapa é publicada sozinha com `git add -A` + commit + push)
**Status:** aprovado pelo dono em 13/09/2026. Decisões registradas nas seções 2 e 12.

**Objetivo:** a partir de um pedido PAGO e ainda NÃO EXPEDIDO, criar um **pedido complementar** do mesmo evento — uma `propostas` nova, sem itens, herdando cliente, endereço, contato, pagador, modalidade e transportadora — cujo frete é **só a diferença** entre a cotação do peso somado (original + complemento) e o que o original já cobrou; e fazer a Expedição enxergar o par e despachar os dois numa caixa só.

**Arquitetura:**
- Vínculo = coluna `propostas.id_int_pedido_principal` (FK → `propostas.id_int`). Lida pela lista, pelo formulário, pelo detalhe e pelo painel da Expedição.
- Ledger append-only `public.complementos_frete`: uma linha por aplicação de frete complementar, idempotente por `chave uuid`, com carimbo de desvinculação escrito só por RPC.
- Três RPCs `SECURITY DEFINER` (criar / aplicar frete / desvincular), todas abrindo com `cc__assert_permissao`, revalidando os gates no banco sob `FOR UPDATE`.
- Duas rotas Next (`/api/orcamentos/complementar/cotar-frete` e `/aplicar-frete`) no molde de `src/app/api/expedicao/recotacao/{cotar,aplicar}/route.ts`: cotação server-side via `cotarOpcoesFretePorEndereco`, recotação no servidor antes de gravar, idempotência por chave.
- **Toda escrita de frete cai em `cotacao_frete` DO COMPLEMENTO.** Os três triggers dessa tabela são `FOR EACH ROW` e escrevem em `propostas WHERE id_int = <linha tocada>` — logo agem só sobre o complemento. Nada toca `cotacao_frete`, `valor_frete` ou `valor_total` do original.
- Expedição: `listarPainelExpedicao` ganha uma consulta (complementos por principal), `PedidoExpedicao` ganha `pedidoPrincipal`/`complementos[]`, `despachar()` ganha o gate de complemento aberto, o override "Desvincular e despachar separado" e o despacho conjunto.

**Stack:** Next.js App Router (route handlers `runtime=nodejs`), Supabase/PostgREST direto do browser nos services, Postgres (plpgsql, RLS; triggers existentes intocados), TypeScript estrito, `ActionsMenu`, migrations SQL em `supabase/migrations/`.

## Restrições globais

- **NUNCA** escrever em `cotacao_frete` do ORIGINAL (INSERT, UPDATE ou DELETE). Triggers verificados no banco em 13/09/2026: `trg_recalc_after_frete` → `recalcular_proposta_v3` (reescreve `valor`, `volume`, `valor_total`); `trg_frete_sync_financeiro` → `atualizar_status_financeiro_proposta` (reescreve `status_interno`; NOVO/AGUARDANDO/APROVADO/LIBERADO **não** são protegidos); `tg_recalc_frete_v4` (no-op).
- **NÃO** recotar o original. A cotação do peso somado é do complemento e mora no ledger.
- **NÃO** alterar `recalcular_proposta_v3`, `atualizar_status_financeiro_proposta`, `check_and_promote_proposta` nem trigger algum.
- **NÃO** reaproveitar `is_copia` / `id_int_origem_copia` / `copiar_proposta_v2`.
- Migrations `YYYYMMDD_descricao.sql` com cabeçalho longo (O QUE É / POR QUÊ / O QUE NÃO FAZ / VERIFICAÇÃO / ROLLBACK), molde `20260819_expedicao_recotacoes.sql`. Tabela nova nasce com ALL para `authenticated` pelos default privileges — o RLS é o que segura.
- Commit `tipo(modulo): descricao` em ASCII, sem aspas duplas (PowerShell 5.1). Validar sempre com `npx tsc --noEmit` e `npx eslint <arquivos>`.
- A permissão `propostas.complementar` só é concedida a perfis na última etapa (E10), mas **não nasce sem dono**. Na tela, o item do menu usa `hasPermissao` e só aparece para o coringa `*` do Super Administrador. No banco, `cc__assert_permissao` também aprova qualquer usuário com `usuarios.is_admin = true`, mesmo sem a chave no perfil: em 13/09/2026 são 2 usuários do perfil Administrador, um deles o de teste. O dono aceitou esse comportamento em 13/09/2026, e `cc__assert_permissao` não muda, porque é compartilhada por todo o sistema. As etapas intermediárias podem ir ao ar sem que um vendedor crie complementos antes de o fluxo estar inteiro.

---

## 0. Contexto — por que isto existe

Hoje, quando o cliente pede itens a mais num pedido já pago do mesmo evento, o único caminho é **editar o original pago** (`/api/orcamentos/editar-paga`): os itens novos entram na mesma proposta, a diferença devedora é silenciosa (sem modal, sem pendência — regra de 22/07/2026 em `src/features/cobrancas/services/diferenca-financeira-proposta.ts:216-231`) e vira uma "cobrança complementar" = **nova linha em `pagamentos_v2` no mesmo `id_int`** (`PropostaCobrancaPanel.tsx:277-284, 408-413`). Limitações que o dono quer resolver:

- não há como distinguir depois o que foi vendido na primeira rodada e o que foi acrescentado (`produtos_proposta` só tem `status_item`);
- o frete **não** acompanha o peso novo (a modalidade/transportadora ficam congeladas depois de AGUARDANDO — `lib/modalidade-frete.ts:53`); o guarda `frete-desatualizado` só bloqueia a cobrança, não recalcula;
- `editar-paga/route.ts:271-273` não verifica "não expedido" — um pedido EM TRANSITO aceita a edição;
- a Expedição não sabe que dois pedidos vão na mesma caixa: `expedicoes.id_int` é UNIQUE, um pedido = um card, zero agrupamento por cliente/endereço/evento.

"Pedido complementar", "juntar pedidos", "mesmo evento": **zero ocorrências** no código e nos docs (grep em 13/09). O conceito nasce aqui.

## 1. O que já existe — e o que serve ou não

| O que | Onde | Serve? |
|---|---|---|
| `copiar_proposta_v2(p_id_int_origem)` — RPC no banco (sem migration com o corpo), chamada por `duplicarProposta` | `src/features/orcamentos/services/orcamentos.service.ts:3088-3162` | **Como molde estrutural, sim** (guarda de entrada, lista explícita de colunas, chat nos dois lados). **Como função, não**: zera `id_endereco_ent`, `contato`, `id_faturado`, `texto_whatsapp`; copia itens/variações/desconto e `valor`/`valor_total` (mas não `valor_frete` → total inconsistente); `modalidade_frete`/`transporte_categoria`/`categoria_frete` caem para NULL; marca `is_copia=true` (esconde da `vw_cadastros_lista_completa` e proíbe copiar de novo). O complemento precisa exatamente do contrário: herdar endereço/contato/pagador/modalidade e NÃO ter itens. |
| `id_int_origem_copia` (FK `ON DELETE SET NULL`) + `is_copia` | banco; **nenhum leitor em `src/`** | Não. Semântica de cópia; misturar os dois conceitos numa coluna exige flag extra e confunde. |
| `id_cupincha` | coluna `bigint` órfã, zero uso no repo | Não. Semântica desconhecida. |
| Tabela de relação entre propostas | — | **Não existe.** Todas as filhas (`cotacao_frete`, `produtos_proposta`, `expedicoes`, `pagamentos_v2`, …) são 1:N por `id_int`. |
| Menu de ações da lista | `getActions(item)` em `OrcamentosListPageReal.tsx:1285-1392`; `ActionsMenu.tsx:8-13` | Sim. Precedentes: condicionar por status (`:1359`), por permissão (`:1390`), modal (`CancelPropostaModal` `:1955`, `LiberarProducaoModal` `:1944`). Hoje **nenhuma** ação é condicionada a "pago"/"expedido". |
| Cotadoras puras de frete | `frete.service.ts:36/206/305/404` — peso em GRAMAS, `id_int` opcional, nada gravam | Sim. |
| Orquestrador server-side `cotarOpcoesFretePorEndereco(endereco, { pesoGramas, valorTotal })` | `src/features/maestro/core/agent/maestro-agent-frete.server.ts:125`; `enderecoFreteDeCep` `:209` | **Sim — é o coração do frete complementar.** Já usado por `api/expedicao/recotacao/{cotar,aplicar}`. |
| Ledger + RPC de recotação (`expedicao_recotacoes`, `exp_liberar_recotacao`) | `supabase/migrations/20260819_expedicao_recotacoes.sql`, `20260820_…liberacoes.sql` | Sim, como **molde** (CHECKs de coerência, `chave` idempotente, `cc__assert_permissao`, REVOKE/GRANT). Não como mecanismo: recusa `diferenca > 0`, só CIF, só em EXPEDICAO. |
| Guarda de frete desatualizado | `src/features/orcamentos/services/frete-desatualizado.ts`; consumida por `/api/propostas/frete-status` e `PropostaCobrancaPanel.tsx:975` | Sim, e impõe uma regra ao desenho: compara `cotacao_frete.peso` com SUM(`produtos_proposta.peso_total`) **do mesmo `id_int`** (tolerância 1 g). Logo `cotacao_frete.peso` do complemento tem de guardar o peso **do próprio complemento**; o somado vai para o ledger. |
| Precedência de peso | `src/features/expedicao/lib/peso.ts` — `resolverPesoExpedicao`: aferido > bruto da Revisão > cotado > teórico | Sim, para o peso do original. |
| "Pago" (integral) | `status-engine.service.ts:90-100` (`pagoCents >= totalCents` → LIBERADO); banco: `cc__valor_pago(id_int)` (desconta `[ABATIMENTO_DEBITO:x]`); `A_VENCER + confirmado` conta como aprovado | Sim. |
| "Não expedido" | marcador oficial `expedicoes.data_despacho IS NOT NULL` (`expedicao/types.ts:349-362`); ressalvas: TRANSPORTADORA/MOTOBOY despachados ficam em EXPEDICAO com `coletado_em` nulo; `data_despacho` é foto do último acontecido (caso #21594) | Sim, como **regra composta**: status entre LIBERADO e EXPEDICAO **e** sem `data_despacho`. Medido: das 3.652 pagas desde junho, 3.569 não expedidas; 0 saíram sem `data_despacho`; 4 têm `data_despacho` com status que voltou. |
| Painel e despacho da Expedição | `expedicao.service.ts:121-956` (`listarPainelExpedicao`), `expedicao-acoes.service.ts:157-341` (`despachar`, PostgREST direto do browser, sem rota), `DespacharModal.tsx`, etiqueta `GET /api/expedicao/etiqueta?id_int=X` (singular), prepostagem 1 objeto por pedido | Sim, como pontos de extensão. Não há nada que ligue dois pedidos. |
| `check_and_promote_proposta` | banco | Só promove a REVISAO ATENDENTE com todas as cobranças confirmadas **e** (arte APROVADO ou todos os itens de prateleira). Com 0 itens nunca promove — o complemento sem itens fica em NOVO. |

## 2. Decisões tomadas pelo dono (13/09/2026)

1. **Vínculo = coluna nova** `propostas.id_int_pedido_principal`. Não reaproveitar cópia.
2. **Frete somado menor que o já cobrado:** complemento cobra **0,00**; a diferença negativa fica só no ledger. Nenhuma escrita no original, nenhum crédito automático.
3. **Original chega em EXPEDICAO com complemento não pronto:** `despachar()` do original **recusa**; override explícito **"Desvincular e despachar separado"** (desfaz o vínculo; o complemento passa a precisar de frete próprio).
4. **Permissão nova `propostas.complementar`** (JSONB em `perfis.permissoes`; `cc__assert_permissao` na RPC; `hasPermissao` na tela; `verificarPermissaoServerSide` nas rotas).

Segunda rodada de decisões (13/09/2026, na aprovação do plano):

5. **Despacho conjunto EXIGE complemento pago — checagem explícita.** Complemento em EXPEDICAO sem pagamento integral (`cc__valor_pago(Y) < round(valor_total,2)`) é tratado como não pronto: bloqueia o despacho do original, com o mesmo override "Desvincular e despachar separado" (seção 7, guarda (e)).
6. **Um complemento aberto por original**, por enquanto (gate 7 da RPC de criação).
7. **Fiscal — uma caixa com duas NF-e: PENDENTE**, decisão com a contabilidade. Pendência aberta; nada é implementado sobre isso.
8. **Arte:** o complemento passa por arte como qualquer proposta. **Não herda** `pedidos_modelos` nem `pedidos_artes` do original.
9. **Serviço de frete do complemento: livre**, com destaque "Mesmo serviço do #X" na lista de opções.
10. **Perfis que recebem `propostas.complementar` em E10:** Administrador (`perfis.id = 2`) e Vendedor (`perfis.id = 4`) — ids conferidos no banco em 13/09/2026.
11. **Cancelamento do complemento:** aceitar `propostas.cancel` em origem COMERCIAL (além de `propostas.complementar`).
12. **Peso do original:** mantém a precedência de `src/features/expedicao/lib/peso.ts` (aferido > bruto da Revisão > cotado > teórico).

## 3. Modelo de dados (esboço — PROPOSTA, não código de produção)

### 3.1 Coluna de vínculo

```sql
alter table public.propostas add column if not exists id_int_pedido_principal bigint;
alter table public.propostas add constraint propostas_id_int_pedido_principal_fkey
  foreign key (id_int_pedido_principal) references public.propostas (id_int) on delete restrict;
alter table public.propostas add constraint propostas_pedido_principal_nao_auto_ck
  check (id_int_pedido_principal is null or id_int_pedido_principal <> id_int);
create index if not exists propostas_id_int_pedido_principal_idx
  on public.propostas (id_int_pedido_principal) where id_int_pedido_principal is not null;
comment on column public.propostas.id_int_pedido_principal is
  'Pedido COMPLEMENTAR: id_int da proposta principal (mesmo evento). Escrita so por criar_pedido_complementar / desvincular_pedido_complementar. NAO confundir com id_int_origem_copia (duplicacao).';
```

`ON DELETE RESTRICT` (e não `SET NULL` como a cópia): a única deleção física de `propostas` no app é o cleanup de proposta órfã na criação (`orcamentos.service.ts`, ramo `catch` do `saveProposta`), que nunca tem complemento; qualquer outra deve estourar em vez de apagar o vínculo em silêncio. Nenhum trigger de `propostas` lê ou escreve a coluna (verificado: `set_timestamp`, `set_updated_at`, `valor_total_avulsa`, `registrar_paid_at`, `audit`, `sync_cliente`).

### 3.2 Ledger `public.complementos_frete`

```sql
create table public.complementos_frete (
  id                         bigint generated always as identity primary key,
  id_int_complemento         bigint not null references public.propostas (id_int),
  id_int_principal           bigint not null references public.propostas (id_int),
  chave                      uuid   not null,
  aplicado_em                timestamptz not null default now(),
  autor_uid uuid, autor_nome text, autor_email text,
  -- pesos em GRAMAS (mesma unidade de cotacao_frete.peso)
  peso_original_gramas       integer not null,
  peso_origem_original       text    not null,   -- AFERIDO | BRUTO_REVISAO | COTADO | TEORICO (rotulo de lib/peso.ts)
  peso_complemento_gramas    integer not null,
  peso_somado_gramas         integer not null,
  frete_total_cotado         numeric(12,2) not null,
  frete_cobrado_original     numeric(12,2) not null,   -- propostas.valor_frete do ORIGINAL no ato
  diferenca                  numeric(12,2) not null,
  frete_cobrado_complemento  numeric(12,2) not null,   -- o que foi para cotacao_frete/valor_frete do COMPLEMENTO
  transportadora text not null, servico text not null, prazo text, cep text not null,
  id_endereco_entrega        uuid references public.enderecos (id),
  modalidade                 text not null,
  -- retrato dos gates no ato (registro, nunca fonte)
  status_original_no_ato text not null, status_complemento_no_ato text not null,
  valor_pago_original numeric(12,2) not null,
  subtotal_itens_original numeric(12,2) not null, subtotal_itens_complemento numeric(12,2) not null,
  opcoes_cotadas jsonb,
  -- desvinculacao: carimbo escrito SO por desvincular_pedido_complementar
  desvinculado_em timestamptz, desvinculado_por_uid uuid, desvinculado_por_nome text,
  desvinculado_motivo text, desvinculado_origem text,   -- EXPEDICAO | COMERCIAL
  constraint complementos_frete_chave_uk      unique (chave),
  constraint complementos_frete_nao_auto_ck   check (id_int_complemento <> id_int_principal),
  constraint complementos_frete_pesos_ck      check (peso_original_gramas > 0 and peso_complemento_gramas > 0
                                                  and peso_somado_gramas = peso_original_gramas + peso_complemento_gramas),
  constraint complementos_frete_diferenca_ck  check (diferenca = frete_total_cotado - frete_cobrado_original),
  constraint complementos_frete_cobrado_ck    check (frete_cobrado_complemento = greatest(0, diferenca)),
  constraint complementos_frete_valores_ck    check (frete_total_cotado >= 0 and frete_cobrado_original >= 0),
  constraint complementos_frete_modalidade_ck check (modalidade = 'CIF'),
  constraint complementos_frete_desvinculo_ck check (
    (desvinculado_em is null and desvinculado_motivo is null and desvinculado_origem is null)
    or (desvinculado_em is not null and desvinculado_motivo is not null and desvinculado_origem in ('EXPEDICAO','COMERCIAL')))
);
create index complementos_frete_complemento_idx on public.complementos_frete (id_int_complemento, aplicado_em desc);
create index complementos_frete_principal_idx   on public.complementos_frete (id_int_principal, aplicado_em desc);
alter table public.complementos_frete enable row level security;
create policy complementos_frete_select_authenticated on public.complementos_frete for select to authenticated using (true);
-- SEM policy de INSERT/UPDATE/DELETE: quem escreve sao as RPCs SECURITY DEFINER (mais estrito que expedicao_recotacoes, de proposito).
```

Regras do ledger: "vigente" = linha mais recente por `aplicado_em` daquele `id_int_complemento` (mesmo critério de `recotacaoMap` em `expedicao.service.ts:259-268`). Recotar de novo (itens mudaram) gera linha nova com chave nova. `desvinculado_*` é carimbado em todas as linhas sem carimbo pela RPC de desvinculação; complemento desvinculado sem linha nenhuma fica registrado no `audit.logs_v2` (o UPDATE de `id_int_pedido_principal` passa por `trg_audit_propostas`) e no chat. `modalidade = 'CIF'` porque RETIRA/FOB não cobram frete (`modalidadeCobraFrete`, `lib/modalidade-frete.ts:92`).

### 3.3 Permissão `propostas.complementar`

- Banco: nada a criar em E1 — `perfis.permissoes` é JSONB livre e `cc__assert_permissao` testa `v_perms ? p_perm`. Grant aos perfis só em E10 (molde `20260813_perfil_financeiro_editar_faturado.sql`): `update public.perfis set permissoes = permissoes || '["propostas.complementar"]'::jsonb where id in (<perfis decididos>) and not (permissoes @> '["propostas.complementar"]'::jsonb);`
- Catálogo TS (E3): `src/features/usuarios-perfis/components/PerfisPermissoesPanel.tsx:81-96` → `{ key: "propostas.complementar", label: "Criar Pedido Complementar", desc: "Permite criar, a partir de proposta paga e nao expedida, um pedido complementar do mesmo evento, com frete cobrado pela diferenca do peso somado.", critica: true }`.
- Fallbacks legados (E3): `src/features/auth/usuarios.service.ts` — `PERMISSOES_ADMIN` (`:67`) e `PERMISSOES_GERENTE_COMERCIAL` (`:146`). Só valem para `id_perfil IS NULL`.

## 4. RPCs (esboço)

### 4.1 `criar_pedido_complementar(p_id_int_origem bigint) returns bigint` — SECURITY DEFINER

Gates, nesta ordem, cada um com código próprio na mensagem:
1. `cc__assert_permissao(auth.uid(), 'propostas.complementar')`
2. `select * ... for update` — origem existe (`COMPL_ORIGEM`); o lock serializa duas criações simultâneas
3. não avulsa (`COMPL_AVULSA`)
4. não é ela mesma complemento (`COMPL_ENCADEADO`) — cadeia limitada a 1 nível, como a cópia
5. paga integralmente: `cc__valor_pago(X) >= round(valor_total,2)` e `valor_total > 0` (`COMPL_NAO_PAGA`, mostrando os dois números)
6. não expedida (regra composta): `status_interno IN ('LIBERADO','LIBERADO / EM ARTE','REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO','EM IMPRESSAO','EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE','EXPEDICAO')` (`COMPL_STATUS`) **e** `NOT EXISTS (expedicoes WHERE id_int = X AND data_despacho IS NOT NULL)` (`COMPL_EXPEDIDA`)
7. sem complemento aberto: nenhuma `propostas` com `id_int_pedido_principal = X` e `status_interno <> 'CANCELADO'` (`COMPL_JA_EXISTE`)

INSERT com **lista explícita** (nunca `select *`):
- **Herda:** `user_id, cliente, id_cliente, "cnpjCpf", proposta, prop_reduz, id_conversa, empresa, vendedor, id_vendedor, contato, id_contato, id_endereco_ent, cep, id_faturado, modalidade_frete, id_transportadora_cliente, transporte_categoria, categoria_frete, frete_escolhido, tipo_cob_edeal, tipo_boleto_edeal, tem_veppo, obs_proposta`.
- **Força:** `status_interno='NOVO'`, `valor=0`, `valor_frete=0`, `valor_total=0`, `volume=NULL`, `peso=NULL`, `is_prd_aprovado=false`, `is_copia=false`, `id_int_origem_copia=NULL`, `id_int_pedido_principal=X`, `is_avulso=false`, `libera_nf=false`, `em_arte=false`, `conferencia=false`, `credito_processado=false`, `boleto_aproved=true`, `motivo_reproved=''`, `is_reproved=false`, `obs_tecnica/json_produtos/texto_whatsapp/"PDF"/id_frete/id_cupincha/encerrado_teste_*/liberado_producao_em = NULL`. `status_pedido`, `etapa_operacional`, `prioridade_operacional`, `prazo_operacional`, `obs_pedido` ficam nos defaults.
- **Não copia:** `produtos_proposta`, `produtos_proposta_variacao`, `desconto_proposta`, `cotacao_frete`, `pedidos_modelos`, `pedidos_artes`, `pagamentos_v2`, `boletos`, `expedicoes`, `propostas_os*`, `notas_fiscais`, `propostas_chat`. Arte e modelos: o complemento passa pelo fluxo de arte como qualquer proposta (decisão 8).
- `revoke execute ... from public; grant execute ... to authenticated;`

Duas mensagens de chat (gravadas pelo service depois da RPC, padrão `duplicarProposta` `orcamentos.service.ts:3152-3162`, `tipo SISTEMA`, `setor "Comercial"`):
- no original: `Pedido complementar #Y criado a partir desta proposta (mesmo evento). O complemento herda endereço, contato, pagador, modalidade e transportadora, e cobra só a diferença de frete do peso somado. Os dois saem juntos na Expedição.`
- no complemento: `Pedido complementar da proposta #X. Endereço, contato, pagador, modalidade e transportadora herdados do principal e travados. Sem itens: inclua os produtos e depois cote o frete complementar na aba Fretes.`

Limitação conhecida (documentar em E0): as 4 propostas com `data_despacho` preenchida que voltaram de etapa (caso #21594) são recusadas com `COMPL_EXPEDIDA`.

### 4.2 `complementar_aplicar_frete(...) returns bigint` — SECURITY DEFINER (E6)

Parâmetros: `p_id_int_complemento, p_chave, p_peso_original_gramas, p_peso_origem_original, p_peso_complemento_gramas, p_frete_total_cotado, p_frete_cobrado_original, p_transportadora, p_servico, p_prazo, p_cep, p_id_endereco_entrega, p_subtotal_original, p_subtotal_complemento, p_opcoes_cotadas, p_autor_nome, p_autor_email`.

Sequência: permissão → idempotência (`complementos_frete WHERE chave` → devolve o id existente) → `for update` no complemento e no principal → gates: é complemento vinculado (`COMPL_FRETE_VINCULO`), não avulsa, `modalidade_frete = 'CIF'` (`COMPL_FRETE_MODALIDADE`), **complemento em NOVO/AGUARDANDO** (`COMPL_FRETE_STATUS` — escrever `cotacao_frete` dispara `atualizar_status_financeiro_proposta`, que reescreve status não protegidos; depois de LIBERADO a correção é pelos fluxos existentes), original ainda não expedido (regra composta), guarda otimista `round(original.valor_frete,2) = round(p_frete_cobrado_original,2)` (`COMPL_FRETE_CONCORRENCIA`), peso atual do complemento no banco bate com o cotado ±1 g (`COMPL_FRETE_PESO`) → calcula `diferenca = round(total − cobrado_original, 2)`, `cobrar = greatest(0, diferenca)` → INSERT no ledger → **só no complemento:** `delete from cotacao_frete where id_int = complemento; insert into cotacao_frete (id_int, servico, valor, prazo, cep, peso, escolhido) values (complemento, servico, cobrar, prazo, cep, p_peso_complemento_gramas, true)` → `update propostas set valor_frete = cobrar, frete_escolhido = servico where id_int = complemento` (o v3 não escreve `valor_frete`).

**Por que os triggers agem só no complemento e por que isso é o desejado:** os três triggers são `FOR EACH ROW` e fazem `UPDATE propostas WHERE id_int = NEW/OLD.id_int`. As únicas linhas tocadas têm `id_int = complemento`; o original não tem linha nova, alterada nem apagada; `propostas` não tem trigger que cascateie para `cotacao_frete`. O efeito sobre o complemento é o normal de qualquer orçamento: `valor_total = SUM(itens) − desconto + cobrar`, `status_interno` derivado das cobranças **do próprio complemento**. `cotacao_frete.peso` recebe o peso **do complemento** para a guarda de frete desatualizado continuar válida e a cobrança não ficar bloqueada; o somado, a cotação total e a diferença ficam no ledger.

### 4.3 `desvincular_pedido_complementar(p_id_int_complemento, p_motivo, p_origem, p_limpar_vinculo default true) returns jsonb` — SECURITY DEFINER (E8)

Permissão por origem: `EXPEDICAO` → `expedicao.processar`; `COMERCIAL` → `propostas.complementar` **ou** `propostas.cancel` (decisão 11). Como `cc__assert_permissao` retorna `void` e **levanta exceção** (`ERRCODE 42501`) em vez de devolver booleano — corpo lido no banco em 13/09/2026 —, a alternativa se implementa testando a primeira permissão dentro de um bloco `BEGIN … EXCEPTION WHEN insufficient_privilege THEN` e só então exigindo a segunda; nunca reescrevendo a regra de permissão inline. Motivo obrigatório. `for update` no complemento; exige vínculo. Carimba `desvinculado_*` em todas as linhas do ledger sem carimbo; se `p_limpar_vinculo`, `update propostas set id_int_pedido_principal = null`. Chat nos dois lados. **Não** apaga `cotacao_frete` do complemento (DELETE dispararia `trg_frete_sync_financeiro` e, com o complemento em LIBERADO — não protegido —, o rebaixaria). "Frete a recotar" é estado **derivado**: linha vigente do ledger com `desvinculado_em` preenchido.

## 5. Rotas

### 5.1 `POST /api/orcamentos/complementar/cotar-frete` — não grava nada (E5)

Molde `src/app/api/expedicao/recotacao/cotar/route.ts`: auth dual, `verificarPermissaoServerSide(supabase, uid, "propostas.complementar")` (`src/lib/auth/verificar-permissao.ts:23`), escopo por empresa/vendedor. Entrada `{ idIntComplemento }`.

1. Complemento: `id_int_pedido_principal` nulo → 409 `NAO_E_COMPLEMENTO`; avulsa → 409; `modalidade_frete <> 'CIF'` → 409 `SEM_FRETE_A_COTAR`.
2. Original: regra composta de não expedido → 409 `ORIGINAL_EXPEDIDO`; `id_endereco_ent` diferente do complemento → 409 `ENDERECO_DIVERGENTE`.
3. **Peso do original (g):** `resolverPesoExpedicao` — aferido (`expedicoes.peso_kg`) > bruto (`peso_bruto_kg`) > cotado (`cotacao_frete.peso`) > teórico (SUM `produtos_proposta.peso_total`, não cancelados). O rótulo vai para `peso_origem_original`.
4. **Peso do complemento (g):** SUM `produtos_proposta.peso_total` (não cancelados). Zero → 422 `SEM_PESO`.
5. Endereço: `enderecos` por `id_endereco_ent` do original → `EnderecoFrete`; sem id, `enderecoFreteDeCep(original.cep)`.
6. Valor declarado (seguro Azul/VEPPO) = subtotal dos itens do original + do complemento (nunca `valor_total`, que embute frete).
7. `cotarOpcoesFretePorEndereco(endereco, { pesoGramas: somado, valorTotal })`; remover `OPCAO_RETIRA_BALCAO`.

Saída: `{ idIntComplemento, idIntPrincipal, pesoOriginalGramas, pesoOrigemOriginal, pesoComplementoGramas, pesoSomadoGramas, freteCobradoOriginal, servicoOriginal, endereco, opcoes: [{ id, transportadora, servico, prazo, valorTotalCotado, freteCobradoOriginal, diferenca, valorACobrar, mesmoServicoDoOriginal, chaveIdempotencia }], avisos }`. A chave nasce por opção quando a cotação chega, nunca no clique (padrão `RecotarFreteAdminPanel.tsx:127`).

Cliente: `src/features/orcamentos/services/complementar.client.ts` (molde `expedicao/services/recotacao.client.ts`).

### 5.2 `POST /api/orcamentos/complementar/aplicar-frete` (E6)

Entrada `{ idIntComplemento, chave, opcaoId, valorVisto }`. Idempotência → gates (os de cotar + complemento em NOVO/AGUARDANDO) → **recota no servidor** (frete é preço volátil — mesma razão de `recotacao/aplicar/route.ts:220-247`) → acha `opcaoId`, `|valor − valorVisto| <= 0.01` → RPC 4.2 → chat best-effort nos dois lados (fora da transação, como `aplicar/route.ts:305-330`).

Decisão: rota própria + RPC transacional, **não** dentro do `saveProposta` — o save é PostgREST do browser sem transação, e ledger + `cotacao_frete` em duas chamadas soltas deixariam janela de ledger sem cotação.

## 6. Formulário do complemento (`src/features/orcamentos/OrcamentoFormPage.tsx`)

**Leitura (E4).** `Proposta` (`types.ts:149`) ganha `idIntPedidoPrincipal: number | null` e `complementos: Array<{ idInt; statusInterno }>`; `getPropostaById` (`orcamentos.service.ts`, já `select("*")`) mapeia a coluna e faz 1 select a mais por complementos não cancelados. `PropostaFormState` ganha `idIntPedidoPrincipal`; `const ehComplemento = Boolean(form.idIntPedidoPrincipal)` ao lado de `modalidadeEditavel`. **Sem fretes sintéticos:** quando é complemento e `listarCotacoesFrete` volta vazio, `getPropostaById` **não** fabrica as 4 opções mock (`orcamentos.service.ts:1353-1455`) — senão o fallback marca um card fictício que o save trataria como escolha.

**Badge no cabeçalho (E4).** No `<span>` que agrupa `StatusBadge` + selo de arte (padrão do commit 8cbbf07): `Complemento do #X` (link) e, no principal, `Complemento: #Y · <status>`. Mesmo par em `OrcamentoDetailPage.tsx` ao lado do `StatusBadge`.

**Travas (E4).** Quando `ehComplemento`: selects de endereço, contato e pagador `disabled` com nota "Herdado do pedido #X" e `if (ehComplemento) return;` nos handlers de `enderecoId`; modalidade/transportadora/motoboy `disabled={!modalidadeEditavel || ehComplemento}`; efeito de cotação automática (`:1749`) e `handleCotarFretes` (`:3012`) desligados; botões "Atualizar fretes"/"+ Frete manual" não renderizam.

**Aba Fretes → `FreteComplementarCard` (E6).** Novo `src/features/orcamentos/components/FreteComplementarCard.tsx` (molde `RecotarFreteAdminPanel.tsx`): `Peso do #X` (com a origem), `Peso deste pedido`, `Peso somado`, `Frete cotado (somado)`, `Já cobrado no #X`, `A cobrar aqui`; botão **Cotar frete complementar** → lista de opções (destaque "Mesmo serviço do #X") → **Aplicar** → `router.refresh()`; estado aplicado mostra a linha vigente do ledger; `desvinculado_em` preenchido → faixa vermelha "Frete complementar invalidado — este pedido passou a precisar de frete próprio"; modalidade ≠ CIF → "RETIRA/FOB herdado do #X — sem frete a cobrar"; sem itens salvos → botão desabilitado "Salve os itens antes de cotar".

**`saveProposta` com complemento (E4).** `const ehComplemento = Boolean(formState.idIntPedidoPrincipal)`:
- as exigências de frete escolhido são dispensadas (mesmo tratamento de `propostaSemItens`) — quem segura é a cobrança (E7);
- o bloco DELETE+INSERT de `cotacao_frete` (hoje `orcamentos.service.ts:2818-2870`, depois da reconciliação dos itens desde 26a0cbb) **não roda**: a linha gravada pela RPC é preservada. O form carrega `fretes` de `listarCotacoesFrete` (`frete.service.ts:109-128`) e `freteEscolhidoId = chosenFrete.id`, então `resumo.frete`/`valorTotal`/consolidação final já saem com `valorACobrar` sem regravar nada;
- saem de `propostaData` quando complemento: `frete_escolhido`, `valor_frete`, `modalidade_frete`, `transporte_categoria`, `id_transportadora_cliente`, `categoria_frete`, `id_endereco_ent`, `contato`, `id_contato`, `id_faturado`, `cep` (herdados e travados). `valor`/`valor_total` continuam entrando;
- `editar-paga/route.ts` passa pelo mesmo `saveProposta` — vale lá sem código extra.

## 7. Guardas

- **(a) Endereço/modalidade travados** — form + service (seção 6); no servidor, `cotar-frete` recusa `ENDERECO_DIVERGENTE` e a RPC recusa modalidade ≠ CIF.
- **(b) Original não cancela com complemento aberto (E7)** — `src/app/api/orcamentos/cancelar-proposta/route.ts`: após a idempotência, se existir complemento com `status_interno <> 'CANCELADO'` → 409 `COMPLEMENTO_ABERTO`. `CancelPropostaModal.tsx` mostra o bloqueio e desabilita Confirmar; o servidor é a tranca.
- **(c) `despachar()` do original com complemento fora de EXPEDICAO (E8)** — `expedicao-acoes.service.ts`: lê complementos abertos; havendo algum fora de EXPEDICAO e sem `input.desvincularComplementos` → `{ success:false, code:"COMPLEMENTO_FORA_EXPEDICAO", complementos }`. `DespachoInput` ganha `desvincularComplementos?: { motivo }`; com ele, ANTES do `upsertExpedicao`, chama a RPC 4.3 (`p_origem 'EXPEDICAO'`, `p_limpar_vinculo true`) para cada um; falha em qualquer → nada do despacho é gravado. `DespacharModal.tsx` (gates `:781-800`): faixa com os complementos (em EXPEDICAO = "sai junto"; demais = bloqueio) + checkbox **Desvincular e despachar separado** + motivo obrigatório.
- **Cobrança do complemento (E7)** — `/api/propostas/frete-status` lê `id_int_pedido_principal` e a linha vigente do ledger: sem linha → `FRETE_COMPLEMENTAR_PENDENTE` (bloqueia); `desvinculado_em` → `FRETE_COMPLEMENTAR_INVALIDADO` (bloqueia); senão a comparação de peso de sempre. `frete-desatualizado.ts` ganha os dois motivos e textos; `PropostaCobrancaPanel.tsx:975` já consome.
- **(d) Complemento cancelado (E7)** — depois do status CANCELADO gravado, `desvincular_pedido_complementar(id, 'Complemento cancelado: '||motivo, 'COMERCIAL', p_limpar_vinculo := false)`: ledger carimbado, chat nos dois, vínculo fica como histórico, original não muda; as guardas (b) e (c) já ignoram CANCELADO. Quem tem só `propostas.cancel` (sem `propostas.complementar`) consegue carimbar o ledger, pela decisão 11.
- **(e) Complemento não pago no despacho conjunto (E9)** — `despachar()` do original, para cada complemento em EXPEDICAO, chama `client.rpc("cc__valor_pago", { p_id_int })` (executável por `authenticated`, conferido em 13/09/2026) e compara com `round(valor_total,2)` (`valor_total > 0`). Não pago → `{ success:false, code:"COMPLEMENTO_NAO_PAGO", complementos }`, com o mesmo override "Desvincular e despachar separado" da guarda (c). É a mesma regra de "paga integralmente" da RPC de criação (decisão 5).

## 8. Expedição

**Painel (E8).** `listarPainelExpedicao`: o select-base de `propostas` (`expedicao.service.ts:135`) ganha `id_int_pedido_principal`; 10ª consulta no `Promise.all`: `propostas.select("id_int, id_int_pedido_principal, status_interno").in("id_int_pedido_principal", ids).neq("status_interno","CANCELADO")` (necessária porque complementos em NOVO/AGUARDANDO não estão no funil). `PedidoExpedicao` ganha `pedidoPrincipal: { idInt } | null` e `complementos: Array<{ idInt; statusInterno; prontoParaSair }>`. Chips `Compl. de #X` / `+ compl. #Y` (verde se pronto, âmbar se não) no card do Kanban (`KanbanTransportadoras.tsx:641-665`) e na linha da lista; filtro `vinculo = TODOS | COMPLEMENTO | PRINCIPAL` no `filtrosSchema` (`ExpedicaoPage.tsx:659-670`); busca textual acha o par pelo número do outro. `despachar()` de um complemento cujo principal ainda não tem `data_despacho` recusa: "o despacho é feito pelo pedido principal, e os dois saem juntos".

**Despacho conjunto (E9).** Antes de gravar qualquer coisa, a guarda (e) da seção 7 confirma que cada complemento em EXPEDICAO está pago integralmente. Em `despachar()`, depois de gravar e transicionar o original: extrair o ternário de destino (`:203-208`) para `src/features/expedicao/lib/destino-despacho.ts`; reler complementos em EXPEDICAO **do banco**; para cada um `upsertExpedicao(c.idInt, { modalidade_frete, tipo_frete, transportadora_nome, categoria_frete, id_transportadora_cliente, id_endereco_entrega, tipo_volume, data_despacho: <mesmo ISO>, despachado_por, obs: "Despachado junto com #X" })` — **sem** `peso_kg`/`qtd_volumes` (o objeto é um só; ficam no original) e **sem** `codigo_rastreamento` nem `correios_codigo_objeto` em `expedicoes` (o webhook dos Correios casa o evento com `.eq("correios_codigo_objeto", objeto).maybeSingle()` e, na falta, `.eq("codigo_rastreamento", objeto).maybeSingle()` em `src/app/api/correios/webhook/route.ts:229-241` — duas linhas com o mesmo código quebrariam o evento; conferido em 13/09/2026); o rastreio vai para `propostas_os.codigo_rastreamento` do complemento (espelho que `listarPainelExpedicao` já usa como fallback) → "Rastrear objeto" funciona no card do complemento; `transicionar(c.idInt, "EXPEDICAO", destino, ator, "Despacho conjunto com #X")`. Resultado `{ complementosDespachados, complementosComFalha }` com toast. Caminho de repetição: `despachar()` num complemento cujo principal **já tem** `data_despacho` copia os campos do `expedicoes` do principal (retry do conjunto e complemento que ficou pronto depois). `confirmarColeta`/entregue propagam para complementos no mesmo status; `voltarStatus` do principal **não** propaga (pendência em E0). Etiqueta 10×15: `montarEtiquetaViewModel` ganha `pedidosNoVolume` e imprime `Pedido #X + #Y`, saindo sempre pelo original. Declaração de conteúdo une os itens dos dois. Prepostagem: 1 objeto = só o principal. **NF-e: PENDENTE — decisão com a contabilidade** (decisão 7). Uma caixa sai com duas notas; a etiqueta imprime a do principal. Pendência aberta; nada é implementado sobre isso.

## 9. Cenários

| Cenário | Comportamento |
|---|---|
| Original cancelado com complemento aberto | 409 `COMPLEMENTO_ABERTO`; cancela só depois de cancelar/desvincular o complemento |
| Complemento cancelado | cancela como proposta comum; RPC carimba o ledger (`p_limpar_vinculo=false`), chat nos dois, vínculo fica como histórico; original livre |
| Original chega em EXPEDICAO antes do complemento | `despachar()` recusa; "Desvincular e despachar separado" limpa vínculo e carimba ledger; o complemento vira proposta comum com frete = diferença (pode ser 0) e `frete-status` bloqueia nova cobrança até recotar; se já pago, correção pelos fluxos existentes (`corrigir-frete`, recotação admin) |
| Complemento nunca pago | fica em NOVO/AGUARDANDO fora do painel, mas aparece no card do original como "+ compl. #Y (NOVO)"; quando o original chega em EXPEDICAO o despacho recusa e o expedidor desvincula |
| Complemento em EXPEDICAO sem pagamento integral | o despacho do original recusa com `COMPLEMENTO_NAO_PAGO` (decisão 5); o expedidor espera o pagamento ou desvincula |
| Complemento salvo sem itens | permitido; card diz "Salve os itens antes de cotar"; cobrança bloqueada por `FRETE_COMPLEMENTAR_PENDENTE` |
| Frete somado menor que o cobrado | ledger `diferenca < 0`, `frete_cobrado_complemento = 0`; `cotacao_frete` do complemento com `valor = 0`; `valor_frete = 0`; nada no original; chat diz que nada é creditado |
| Itens do complemento mudam depois de aplicar | `cotacao_frete.peso` diverge → `PESO_DIVERGENTE` bloqueia cobrança → cotar de novo gera linha nova no ledger |
| Original RETIRA/FOB | complemento herda; card informa "sem frete a cobrar"; nenhuma linha em `cotacao_frete`/ledger; `frete-status` não bloqueia |

## 10. Etapas (ordem de dependência — cada uma cabe numa rodada e é publicável sozinha)

Validação comum: `npx tsc --noEmit`; `npx eslint <arquivos alterados>`; teste real em `http://localhost:3000` (Playwright, `USER_TESTE_ADM`) no cliente **58613 "Teste Testando"**; SELECTs listados; `audit.logs_v2` filtrado por `table_name='propostas'` e `new_data->>'id_int'`.

- [x] **P0 — Massa de teste (não publica).** _(13/09/2026: X = #22067, cliente 58613, 1 item TexBand de 456 g, SEDEX, pago por E-Amostra confirmada pela rota da Conferência, LIBERADO; sem Liberar para Produção, por escolha do dono)_ As propostas 22009, 22021, 22022 do 58613 estão CANCELADO. Criar uma proposta CIF com 1 item pesado (~4,5 kg), SEDEX escolhido, cobrança PIX confirmada até LIBERADO e "Liberar para Produção". Guardar `id_int = X`.

- [x] **E0 — Doc de regra.** _(concluída em 13/09/2026)_ Criar `docs/business/PEDIDO-COMPLEMENTAR.md` (seções 2–9 deste plano + limitações: caso #21594, NF-e dupla, `voltarStatus` não propaga); entrada em `docs/DOCUMENTATION_INDEX.md`. Depende de: nada. Validação: revisão do dono; `git diff --stat` só em docs.

- [x] **E1 — Migration: coluna + ledger.** _(concluída em 13/09/2026; aplicada em produção como versão `20260913204321`)_ Criar `supabase/migrations/20260914_pedido_complementar_vinculo_e_ledger.sql` (3.1 e 3.2; sem grant de permissão). Depende de: E0. Validação (SQL): coluna existe e é nullable; `pg_constraint` de `complementos_frete` mostra os 8 CHECKs/UK; `pg_policy` só `r`; `count(*) where id_int_pedido_principal is not null` = 0; triggers de `cotacao_frete` inalterados.

- [x] **E2 — RPC `criar_pedido_complementar`.** _(concluída em 13/09/2026; aplicada em produção como versão `20260913211243`; validada com X = #22067 e Y = #22068, cancelado)_ Criar `supabase/migrations/20260914_criar_pedido_complementar.sql` (4.1 + REVOKE/GRANT). Depende de: E1. Validação: como superadmin `select criar_pedido_complementar(X)` → Y; SELECT em `propostas` (Y: NOVO, valor 0, frete 0, total 0, `is_prd_aprovado` false, `is_copia` false, endereço/pagador/modalidade iguais aos de X); `count(*) produtos_proposta where id_int=Y` = 0; `count(*) cotacao_frete where id_int=Y` = 0; negativos: repetir (`COMPL_JA_EXISTE`), avulsa 22022 (`COMPL_AVULSA` — o gate 3 vem antes do de status), cancelada e sem pagamento 22021 (`COMPL_NAO_PAGA` — o gate 5 vem antes do 6; para exercitar `COMPL_STATUS` use uma proposta paga fora da faixa, ex.: ENTREGUE), `criar_pedido_complementar(Y)` (`COMPL_ENCADEADO`). Cancelar Y ao final.

- [x] **E3 — Service + menu + modal.** _(concluída em 13/09/2026; validada com X = #22067 e o complemento #22069 criado pelo menu, que fica aberto para a E4)_ Criar `src/features/orcamentos/components/CriarComplementoModal.tsx`; modificar `orcamentos.service.ts` (`criarPedidoComplementar(idInt)` ao lado de `duplicarProposta`, com as 2 mensagens de chat), `mappers.ts` (`idIntPedidoPrincipal` em `OrcamentoListItem`), `columnsToSelect` da lista, `OrcamentosListPageReal.tsx` (`getActions`: "Criar pedido complementar" condicionado a `hasPermissao(user,"propostas.complementar")`, `item.isAvulsoRaw !== true`, `item.idIntPedidoPrincipal == null`, status na lista de não-expedido; modal como `CancelPropostaModal`; badge "Compl. de #X" na linha), `PerfisPermissoesPanel.tsx`, `usuarios.service.ts`. Depende de: E2. Validação: superadmin vê o item em X; confirmar → redirect `/orcamentos/Y/editar?tab=produtos`; chat de X e Y; usuário sem a permissão não vê o item e `client.rpc` direto devolve erro de permissão.

- [x] **E4 — Leitura do vínculo, badges, travas e save neutro.** _(concluída em 13/09/2026; validada com Y = #22069, 1 item de 999 g salvo sem linha em `cotacao_frete`, e a proposta comum #22072 como prova de não regressão)_ `types.ts`, `orcamentos.service.ts` (`getPropostaById`: coluna + complementos + sem fretes sintéticos; `saveProposta`: `ehComplemento`), `OrcamentoFormPage.tsx` (badge, travas, efeito `:1749` e `handleCotarFretes` desligados), `OrcamentoDetailPage.tsx`. Depende de: E3. Validação: abrir Y, incluir 1 item (~1 kg), salvar; `count(*) cotacao_frete where id_int=Y` = 0; Y com `valor` = subtotal, `valor_frete` 0, endereço/modalidade intactos; linha de `cotacao_frete` de X idêntica (mesmo `id`); controle de endereço desabilitado.

- [x] **E5 — Rota cotar-frete.** _(concluída em 14/09/2026; validada com Y = #22069: 456 g + 999 g = 1.455 g, SEDEX a R$ 105,05 com R$ 21,68 a cobrar e Azul com diferença negativa cobrando zero; nada gravado)_ Criar `src/app/api/orcamentos/complementar/cotar-frete/route.ts` e `src/features/orcamentos/services/complementar.client.ts`. Depende de: E4. Validação: resposta com pesos e opções (`diferenca`, `valorACobrar`, `chaveIdempotencia`); `count(*) complementos_frete` = 0; `cotacao_frete` de X/Y inalteradas; 403 sem permissão; 409 para proposta comum.

- [ ] **E6 — Rota aplicar-frete + RPC + card.** Criar `supabase/migrations/20260915_complementar_aplicar_frete.sql`, `src/app/api/orcamentos/complementar/aplicar-frete/route.ts`, `FreteComplementarCard.tsx`; modificar `complementar.client.ts`, `OrcamentoFormPage.tsx` (aba Fretes → card). Depende de: E5. Validação: aplicar SEDEX → 1 linha no ledger com CHECKs satisfeitos; `cotacao_frete`: Y com `valor = a_cobrar` e `peso` = peso de Y, X com a mesma linha de antes (mesmo `id`); `propostas`: X inalterado, Y = subtotal + a_cobrar em NOVO; repetir a mesma chave → idempotente; `audit.logs_v2` só com UPDATEs em Y; `frete-status?idInt=Y` → `EM_DIA`; gerar cobrança de Y e confirmar (LIBERADO) para E8/E9.

- [ ] **E7 — Guardas: cancelamento + cobrança.** `cancelar-proposta/route.ts`, `CancelPropostaModal.tsx`, `/api/propostas/frete-status/route.ts`, `frete-desatualizado.ts`. Depende de: E6 (a chamada da RPC de desvinculação no cancelamento do complemento pode ficar para E8). Validação: cancelar X → 409 `COMPLEMENTO_ABERTO`; complemento sem frete aplicado → aba Pagamentos bloqueia com "frete complementar pendente"; após aplicar, libera.

- [ ] **E8 — Expedição: vínculo no painel + bloqueio + desvincular.** Criar `supabase/migrations/20260915_desvincular_pedido_complementar.sql`; modificar `expedicao/types.ts`, `expedicao.service.ts`, `expedicao-acoes.service.ts` (gate + `desvincularComplementos`), `DespacharModal.tsx`, `KanbanTransportadoras.tsx`, `ExpedicaoPage.tsx`, `cancelar-proposta/route.ts`. Depende de: E6. Validação: X em EXPEDICAO com Y em produção → chip "+ compl. #Y"; Despachar recusa; com "Desvincular e despachar separado" + motivo → `id_int_pedido_principal` de Y = NULL, ledger carimbado, chat nos dois, `frete-status?idInt=Y` → `FRETE_COMPLEMENTAR_INVALIDADO`. Repetir com par novo para E9.

- [ ] **E9 — Despacho conjunto + etiqueta + declaração.** Criar `src/features/expedicao/lib/destino-despacho.ts`; modificar `expedicao-acoes.service.ts` (conjunto + repetição + propagação de coleta/entrega), `DespacharModal.tsx`, `etiqueta-viewmodel.service.ts` + template, `declaracao-viewmodel.service.ts`. Depende de: E8. Validação: X e Y em EXPEDICAO; despachar X (Correios, rastreio R) → `expedicoes`: mesma `data_despacho` nos dois, Y com `obs='Despachado junto com #X'` e sem peso/volumes/rastreio; `propostas_os.codigo_rastreamento` = R nos dois; `status_interno` EM TRANSITO nos dois; `os_status_log`; etiqueta imprime "Pedido #X + #Y"; declaração lista itens dos dois; `count(*) expedicoes where codigo_rastreamento='R'` = 1. Negativo da decisão 5: com Y em EXPEDICAO e uma cobrança não confirmada, despachar X → `COMPLEMENTO_NAO_PAGO`, nada gravado em `expedicoes` de X nem de Y.

- [ ] **E10 — Docs finais + grant da permissão.** Criar `supabase/migrations/20260916_perfis_propostas_complementar.sql` (grant a `perfis.id in (2, 4)` — Administrador e Vendedor, decisão 10); atualizar `docs/business/EXPEDICAO.md`, `FLUXO-OFICIAL-STATUS-PROPOSTAS.md`, `CONTA-CORRENTE-CREDITO.md`, `PEDIDO-COMPLEMENTAR.md`. Depende de: E9. Validação: `select id, nome, permissoes @> '["propostas.complementar"]' from perfis`; Vendedor vê o item do menu.

## 11. Riscos e o que NÃO fazer

- **NÃO** reaproveitar `is_copia`/`id_int_origem_copia`/`copiar_proposta_v2` (seção 1).
- **NÃO** escrever em `cotacao_frete` do original, nem "só o peso": `trg_frete_sync_financeiro` rebaixaria um LIBERADO para APROVADO/NOVO e `trg_recalc_after_frete` reescreveria `valor_total`.
- **NÃO** recotar o original.
- **NÃO** apagar `cotacao_frete` do complemento ao desvincular (mesmo motivo).
- **NÃO** criar entidade "remessa/volume" genérica na V1: vínculo 1→N por coluna resolve; painel e despacho já são por `id_int`.
- **NÃO** usar a edição do original pago como contorno para o mesmo evento (seção 0).
- **NÃO** copiar `codigo_rastreamento` para `expedicoes` do complemento (webhook `maybeSingle` por código).
- **Risco:** RLS de `propostas` é permissiva — qualquer sessão pode escrever `id_int_pedido_principal` por PostgREST. Aceito como o das outras colunas; o app só escreve por RPC e `trg_audit_propostas` registra.
- **Risco:** `atualizar_status_financeiro_proposta` não protege NOVO/AGUARDANDO/APROVADO/LIBERADO — por isso `complementar_aplicar_frete` só aceita NOVO/AGUARDANDO.
- **Risco:** `voltarStatus` do principal não desfaz o despacho dos complementos (pendência documentada).
- **Risco:** `cc__valor_pago` desconta `[ABATIMENTO_DEBITO:x]`; abatimento no original pode fazer "paga integralmente" recusar — `COMPL_NAO_PAGA` mostra os dois números.
- **Risco (do banco, fora deste plano):** `id_contato` chega como string; `contato` é texto; `id_endereco_ent` é `text` apontando para uuid — herdados tal e qual.

## 12. Decisões do dono

Resolvidas em 13/09/2026 (detalhe na seção 2, itens 5 a 12):

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Complemento precisa estar pago para o despacho conjunto? | **Sim, checagem explícita** (guarda (e), seção 7) |
| 2 | Quantos complementos por original? | **Um aberto por vez**, por enquanto |
| 3 | Uma caixa, duas NF-e | **PENDENTE** — decisão com a contabilidade |
| 4 | Arte e modelos | Passa por arte como qualquer proposta; **não herda** modelos nem artes |
| 5 | Serviço de frete do complemento | **Livre**, com destaque "Mesmo serviço do #X" |
| 6 | Perfis que recebem `propostas.complementar` | **Administrador (2) e Vendedor (4)**, em E10 |
| 7 | Cancelamento do complemento só com `propostas.cancel` | **Aceito** em origem COMERCIAL |
| 8 | Peso do original | Mantém a precedência de `lib/peso.ts` |

**Pendência aberta:** item 3 (fiscal). Não bloqueia nenhuma etapa; o despacho conjunto sai com duas notas e a etiqueta imprime a do principal até a contabilidade decidir.

## 13. Verificação ponta a ponta (ao final de E9)

1. Par X/Y do cliente 58613: X LIBERADO → EXPEDICAO; Y com 1 item, frete complementar aplicado, cobrança confirmada, "Liberar para Produção", chega a EXPEDICAO.
2. SELECT antes/depois de `propostas` (X e Y), `cotacao_frete` (X intacta — mesmo `id` desde a criação; Y com `valor = a_cobrar`, `peso` = peso de Y), `complementos_frete` (1 linha vigente), `expedicoes` (após E9: mesma `data_despacho`, peso/volumes só em X), `propostas_os` (rastreio nos dois), `os_status_log`.
3. `audit.logs_v2`: nenhum UPDATE em X vindo de trigger de `cotacao_frete` em todo o ciclo (assinatura `valor,volume,valor_total` só em Y).
4. Etiqueta 10×15 de X imprime "Pedido #X + #Y"; declaração lista itens dos dois; `/api/expedicao/etiqueta?id_int=Y` continua funcionando sozinha (não é o caminho oficial, mas não pode quebrar).
5. Regressões: proposta comum (sem vínculo) cria/salva/cota/despacha exatamente como hoje — repetir o roteiro de `scratch/repro-sedex.mjs` e `scratch/mede-salvar-pedido.mjs` numa proposta nova e comparar valor/valor_total/cotação.

## 14. Publicação

- 13/09/2026 — plano publicado em `docs/superpowers/plans/2026-09-13-pedido-complementar.md` com as decisões do dono.
- Cada etapa é publicada sozinha: `git add -A`, commit `tipo(modulo): descricao` em ASCII sem aspas duplas, `git push origin erp-ideal-preview`. Trabalho de outra sessão na árvore vai junto, por desenho. Ao concluir uma etapa, marcar o checkbox dela neste arquivo no mesmo commit.
