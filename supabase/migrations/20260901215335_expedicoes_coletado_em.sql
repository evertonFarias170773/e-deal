-- expedicoes.coletado_em — o estado "Aguardando coleta", sem status novo
--
-- O QUE MUDA
--   Uma coluna: `public.expedicoes.coletado_em timestamptz NULL`, sem default.
--   Nada mais. Nenhum status novo, nenhum trigger, nenhuma RLS, nenhum backfill.
--
-- POR QUE ESTA COLUNA, E NAO UM STATUS NOVO
--   A operacao precisa distinguir "o expedidor confirmou o despacho" de "a
--   transportadora levou o volume". Entre os dois o pedido fica na casa, rotulado,
--   esperando o carro — e hoje ele ja aparece como EM TRANSITO, que e mentira:
--   ninguem transportou nada ainda.
--
--   A saida obvia seria um `status_interno = 'AGUARDANDO COLETA'`. Ela foi
--   descartada porque o status de proposta e um vocabulario compartilhado por
--   DEZ funcoes do banco, e um valor novo obriga a reavaliar todas:
--
--     osqr__status_qr()                       lista branca do QR de producao;
--                                             status fora dela = FORA_DO_FLUXO
--     osqr__proximo_status(text)              matriz EM PRODUCAO -> ... -> EXPEDICAO
--     osqr__ordinal(text)                     ordem do funil
--     osqr__classificar_transicao(...)        avanco x retrocesso x atalho
--     os_qr_avancar(...)                      leitura do QR no chao de fabrica
--     check_and_promote_proposta(integer)     guarda ITEM A da promocao
--     atualizar_status_financeiro_proposta(integer)  guarda de status protegido
--     atualizar_status_financeiro_proposta(bigint)   idem, a outra sobrecarga
--     rpc_dashboard_executivo(...)            recortes do dashboard
--     rpc_dashboard_vendedor(...)             idem
--
--   Mais, no app: STATUS_FUNIL_EXPEDICAO, etapaDoStatus, status-protegidos.ts,
--   StatusBadge — e o webhook dos Correios, que so aceita transicionar a partir
--   de `statusEsperados = ['EXPEDICAO']` e pararia de casar.
--
--   Com a coluna, "aguardando coleta" e DERIVADO, nao declarado:
--
--     data_despacho IS NOT NULL
--     AND coletado_em IS NULL
--     AND status_interno = 'EXPEDICAO'
--     AND tipo_frete IN ('TRANSPORTADORA', 'MOTOBOY')
--
--   O pedido permanece em EXPEDICAO — um status que as dez funcoes ja conhecem —
--   e a coleta o leva a EM TRANSITO pelo mesmo `transicionar` de sempre, com a
--   mesma guarda de concorrencia e a mesma trilha em os_status_log.
--
-- O RECORTE DE tipo_frete NAO E DECORATIVO
--   Correios continua indo direto a EM TRANSITO (a postagem E a coleta) e RETIRA
--   direto a A RETIRAR. So TRANSPORTADORA e MOTOBOY tem espera pelo carro.
--
--   E e esse recorte que torna o backfill desnecessario. Medido em 01/09/2026:
--   ha TRES pedidos com `data_despacho` preenchida e status anterior a
--   EM TRANSITO — 19514 e 20916 (EXPEDICAO) e 20792 (EM PRODUCAO), todos com
--   `data_despacho` de 16 a 19/08 e status devolvido depois. Os tres sao
--   CORREIOS, entao nenhum entra no recorte. Com a coluna nascendo nula em toda
--   a base, ZERO pedidos passam a parecer "aguardando coleta" retroativamente.
--
-- O QUE NAO MUDA
--   - `data_despacho` continua significando "o expedidor confirmou o despacho",
--     que e exatamente o que ela sempre significou. Os cinco consumidores dela
--     (lista, etiqueta 10x15, declaracao de conteudo, recotacao e a referencia
--     de transporte do DespacharModal) seguem lendo o mesmo sinal;
--   - nenhum trigger e disparado: `public.expedicoes` NAO TEM TRIGGER NENHUM,
--     conferido em pg_trigger e assertado abaixo;
--   - RLS de expedicoes intocada; ADD COLUMN nulavel nao reescreve a tabela nem
--     pega lock longo.
--
-- KILL-SWITCH NATURAL
--   Enquanto o app nao escrever em `coletado_em`, a coluna fica nula em todas as
--   linhas e nenhuma leitura muda. A migration e inerte sozinha.

begin;

-- 1. ASSERCOES DE ENTRADA -----------------------------------------------------
do $$
declare
  v_col int;
  v_trg int;
begin
  select count(*) into v_col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'expedicoes' and column_name = 'coletado_em';

  if v_col > 0 then
    raise exception 'ABORTADO: public.expedicoes.coletado_em ja existe. Migration ja aplicada?';
  end if;

  select count(*) into v_trg
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname = 'public' and c.relname = 'expedicoes';

  if v_trg <> 0 then
    raise exception 'ABORTADO: public.expedicoes passou a ter % trigger(s). A premissa de que o ADD COLUMN nao dispara nada deixou de valer — reconferir antes de aplicar.', v_trg;
  end if;

  raise notice 'Entrada OK: coluna ausente, zero triggers em expedicoes.';
end $$;

-- 2. A COLUNA -----------------------------------------------------------------
--    Nulavel e sem default de proposito: NULL e a ausencia de coleta, e um
--    default faria toda linha existente nascer "coletada".
alter table public.expedicoes
  add column coletado_em timestamptz;

comment on column public.expedicoes.coletado_em is
  'Quando a transportadora/motoboy retirou o volume. NULL com data_despacho preenchida, status EXPEDICAO e tipo_frete TRANSPORTADORA/MOTOBOY significa "aguardando coleta". Correios e retirada nao usam esta coluna — a postagem e a retirada ja sao o proprio evento de saida.';

-- 3. ASSERCOES DE SAIDA -------------------------------------------------------
do $$
declare
  r record;
  v_nao_nulas int;
  v_retroativos int;
begin
  select data_type, is_nullable, column_default
    into r
  from information_schema.columns
  where table_schema = 'public' and table_name = 'expedicoes' and column_name = 'coletado_em';

  if not found then
    raise exception 'ABORTADO: coletado_em nao foi criada.';
  end if;
  if r.data_type <> 'timestamp with time zone' then
    raise exception 'ABORTADO: coletado_em nasceu como %, esperado timestamptz.', r.data_type;
  end if;
  if r.is_nullable <> 'YES' then
    raise exception 'ABORTADO: coletado_em nasceu NOT NULL.';
  end if;
  if r.column_default is not null then
    raise exception 'ABORTADO: coletado_em nasceu com default (%).', r.column_default;
  end if;

  select count(*) into v_nao_nulas from public.expedicoes where coletado_em is not null;
  if v_nao_nulas <> 0 then
    raise exception 'ABORTADO: % linha(s) ja nasceram com coletado_em preenchido.', v_nao_nulas;
  end if;

  -- O que interessa de fato: ninguem vira "aguardando coleta" por acidente.
  select count(*) into v_retroativos
  from public.expedicoes e
  join public.propostas p on p.id_int = e.id_int
  where e.data_despacho is not null
    and e.coletado_em is null
    and p.status_interno = 'EXPEDICAO'
    and e.tipo_frete in ('TRANSPORTADORA', 'MOTOBOY');

  if v_retroativos <> 0 then
    raise exception 'ABORTADO: % pedido(s) passariam a aparecer como aguardando coleta retroativamente. Esperado 0 — conferir antes de seguir.', v_retroativos;
  end if;

  raise notice 'Saida OK: coluna timestamptz nulavel sem default, todas as linhas nulas, zero retroativos.';
end $$;

commit;

-- 4. CONFERENCIA POS-APLICACAO (somente leitura) ------------------------------
--
--    4.1 A coluna (esperado: timestamp with time zone / YES / default nulo)
--
--      select data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema='public' and table_name='expedicoes' and column_name='coletado_em';
--
--    4.2 Nenhum trigger apareceu (esperado: 0)
--
--      select count(*) from pg_trigger t
--      join pg_class c on c.oid=t.tgrelid
--      join pg_namespace n on n.oid=c.relnamespace
--      where not t.tgisinternal and n.nspname='public' and c.relname='expedicoes';
--
--    4.3 Aguardando coleta hoje (esperado: 0 ate o app comecar a usar)
--
--      select e.id_int, p.status_interno, e.tipo_frete, e.data_despacho
--      from public.expedicoes e join public.propostas p on p.id_int=e.id_int
--      where e.data_despacho is not null and e.coletado_em is null
--        and p.status_interno='EXPEDICAO'
--        and e.tipo_frete in ('TRANSPORTADORA','MOTOBOY');
--
--    4.4 Os tres com data_despacho fora do funil seguem CORREIOS e de fora
--        (esperado: 19514, 20916, 20792, todos CORREIOS)
--
--      select e.id_int, p.status_interno, e.tipo_frete
--      from public.expedicoes e join public.propostas p on p.id_int=e.id_int
--      where e.data_despacho is not null
--        and p.status_interno in ('EXPEDICAO','EM PRODUCAO','EM ACABAMENTO','REVISAO PRODUCAO')
--      order by e.id_int desc;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   A coluna e aditiva e nasce nula em toda a base: derruba-la devolve o estado
--   anterior byte a byte, desde que o app ainda nao esteja gravando nela. Se ja
--   estiver, DROP apaga o registro de quem coletou e quando — e ai o caminho e
--   parar o app primeiro.
--
--   Nenhum outro objeto foi criado. Nenhum dado foi alterado.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- alter table public.expedicoes drop column coletado_em;
