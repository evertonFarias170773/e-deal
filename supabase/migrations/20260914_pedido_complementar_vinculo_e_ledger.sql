-- Pedido complementar, Etapa E1 — coluna de vinculo em `propostas` e o ledger
-- `complementos_frete`
--
-- Plano: docs/superpowers/plans/2026-09-13-pedido-complementar.md (secao 3)
-- Regra: docs/business/PEDIDO-COMPLEMENTAR.md
--
-- O QUE E
--   Schema ADITIVO, e so ele:
--     1. `propostas.id_int_pedido_principal` (bigint, nula) — marca que uma
--        proposta e COMPLEMENTO de outra, do mesmo evento. FK para
--        `propostas.id_int`, CHECK contra auto-referencia, indice parcial;
--     2. `public.complementos_frete` — livro-razao append-only, uma linha por
--        aplicacao de frete complementar, idempotente por `chave`.
--   Nenhuma linha e escrita. Depois desta migration a coluna esta nula em
--   todas as propostas e o ledger esta vazio.
--
-- POR QUE UMA COLUNA NOVA, E NAO `id_int_origem_copia`
--   `id_int_origem_copia` e `is_copia` sao da DUPLICACAO de proposta
--   (`copiar_proposta_v2`), que zera endereco, contato e pagador e copia itens
--   e valores — o contrario do complemento. Misturar os dois conceitos numa
--   coluna exigiria um flag extra e confundiria quem le. Decisao do dono em
--   13/09/2026.
--
-- POR QUE `ON DELETE RESTRICT` (e nao `SET NULL`, como a copia)
--   A unica delecao fisica de `propostas` no app e o cleanup de proposta orfa
--   na criacao (ramo `catch` do `saveProposta`), que nunca tem complemento.
--   Qualquer outra delecao de um principal com complemento vinculado deve
--   estourar em vez de apagar o vinculo em silencio.
--
-- POR QUE O LEDGER EXISTE
--   O frete do complemento e a DIFERENCA entre a cotacao do peso somado
--   (original + complemento) e o que o original ja cobra. Nada disso cabe em
--   `cotacao_frete`: a linha do complemento guarda o peso DO PROPRIO
--   complemento (a guarda de frete desatualizado compara com a soma dos itens
--   do mesmo `id_int`), e a do original nao pode ser tocada. O ledger e a unica
--   memoria de com quanto o frete complementar foi calculado.
--
-- RLS: SO LEITURA
--   Uma policy de SELECT para `authenticated`. SEM policy de INSERT, UPDATE ou
--   DELETE: quem escreve sao as RPCs SECURITY DEFINER das etapas E6 e E8. Mais
--   estrito que `expedicao_recotacoes` (que tem INSERT para authenticated), de
--   proposito.
--   A tabela nasce com ALL para `authenticated` e `service_role` pelos default
--   privileges de `public` (sem `anon`, desde 20260901161119) — conferido em
--   13/09/2026. Quem tranca a escrita e o RLS, nao o GRANT.
--
-- LOCK
--   `ALTER TABLE propostas` pede ACCESS EXCLUSIVE na tabela mais escrita do
--   sistema. A coluna e nula e sem default (so metadado), e as constraints e o
--   indice varrem ~9 mil linhas: milissegundos. `lock_timeout = 5s` faz a
--   migration FALHAR sem aplicar nada se o lock nao vier, em vez de enfileirar
--   as escritas dos vendedores atras dela.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO toca `cotacao_frete` nem nenhum dos tres triggers dela
--   (`trg_recalc_after_frete`, `trg_frete_sync_financeiro`,
--   `tg_recalc_frete_v4`).
--   NAO altera trigger, funcao, view nem RLS de tabela existente.
--   NAO usa `is_copia`, `id_int_origem_copia` nem `copiar_proposta_v2`.
--   NAO cria RPC (E2, E6 e E8).
--   NAO concede `propostas.complementar` a perfil nenhum (E10).
--   NAO escreve dado nenhum.
--
-- VERIFICACAO (rodar depois de aplicar)
--
-- a) Coluna existe e e nullable:
--    SELECT column_name, data_type, is_nullable FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'propostas'
--       AND column_name = 'id_int_pedido_principal';
--    Esperado: bigint, YES.
--
-- b) Constraints e indice em `propostas`:
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname IN ('propostas_id_int_pedido_principal_fkey',
--                       'propostas_pedido_principal_nao_auto_ck');
--    SELECT indexdef FROM pg_indexes
--     WHERE indexname = 'propostas_id_int_pedido_principal_idx';
--    Esperado: FK ON DELETE RESTRICT, CHECK, indice parcial WHERE NOT NULL.
--
-- c) Constraints do ledger (Postgres 17: NOT NULL nao aparece aqui):
--    SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'public.complementos_frete'::regclass ORDER BY contype, conname;
--    Esperado: 7 CHECK + 1 UNIQUE (chave) + 1 PK + 3 FK = 12.
--
-- d) RLS so leitura:
--    SELECT relrowsecurity FROM pg_class WHERE oid = 'public.complementos_frete'::regclass;
--    SELECT polname, polcmd, polroles::regrole[] FROM pg_policy
--     WHERE polrelid = 'public.complementos_frete'::regclass;
--    Esperado: true; UMA policy, polcmd = 'r', role authenticated.
--
-- e) Nada escrito:
--    SELECT count(*) FROM public.propostas WHERE id_int_pedido_principal IS NOT NULL;  -- 0
--    SELECT count(*) FROM public.complementos_frete;                                    -- 0
--
-- f) Triggers de `cotacao_frete` e `propostas` inalterados: comparar
--    md5(pg_get_triggerdef) e md5(pg_get_functiondef) com o retrato de antes.
--
-- ROLLBACK
--   Limpo ENQUANTO nenhum complemento tiver sido criado e o ledger estiver
--   vazio (confira os dois SELECTs de (e) antes):
--     DROP TABLE public.complementos_frete;
--     SET LOCAL lock_timeout = '5s';
--     DROP INDEX public.propostas_id_int_pedido_principal_idx;
--     ALTER TABLE public.propostas DROP CONSTRAINT propostas_pedido_principal_nao_auto_ck;
--     ALTER TABLE public.propostas DROP CONSTRAINT propostas_id_int_pedido_principal_fkey;
--     ALTER TABLE public.propostas DROP COLUMN id_int_pedido_principal;
--   Depois do primeiro complemento, derrubar a coluna apaga o unico registro de
--   que dois pedidos sao do mesmo evento, e derrubar o ledger apaga a unica
--   trilha de como o frete complementar foi calculado.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Coluna de vinculo em `propostas`
-- ---------------------------------------------------------------------------

alter table public.propostas add column if not exists id_int_pedido_principal bigint;

alter table public.propostas add constraint propostas_id_int_pedido_principal_fkey
  foreign key (id_int_pedido_principal) references public.propostas (id_int) on delete restrict;

alter table public.propostas add constraint propostas_pedido_principal_nao_auto_ck
  check (id_int_pedido_principal is null or id_int_pedido_principal <> id_int);

create index if not exists propostas_id_int_pedido_principal_idx
  on public.propostas (id_int_pedido_principal) where id_int_pedido_principal is not null;

comment on column public.propostas.id_int_pedido_principal is
  'Pedido COMPLEMENTAR: id_int da proposta principal (mesmo evento). Escrita so por criar_pedido_complementar / desvincular_pedido_complementar. NAO confundir com id_int_origem_copia (duplicacao).';

-- ---------------------------------------------------------------------------
-- 2. Ledger `public.complementos_frete`
-- ---------------------------------------------------------------------------

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

create policy complementos_frete_select_authenticated on public.complementos_frete
  for select to authenticated using (true);

-- SEM policy de INSERT/UPDATE/DELETE: quem escreve sao as RPCs SECURITY DEFINER
-- (mais estrito que expedicao_recotacoes, de proposito).
