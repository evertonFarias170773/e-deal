-- ============================================================================
-- Bonus da tabela especial gravado na venda — Fase 3b: a CARGA das linhas
-- ============================================================================
--
-- Grava UMA linha `desconto_proposta` TABELA_ESPECIAL em 169 propostas e tira
-- as 15 linhas legadas dessas mesmas propostas (tipo nulo ou "Tabela especial"),
-- que a v3 e a v4 ainda aplicariam como desconto — ficar com as duas daria
-- desconto em dobro.
--
-- A LISTA (decisoes do dono em 30/09/2026)
--   D  8 propostas pagas, o percentual PROVADO pelo que foi cobrado:
--        12049, 14154, 14793, 14917 = 3%  (o total gravado bate com 3%)
--        14533, 19348, 19508       = 0%  (vendidas pelo bruto)
--        18360                     = 0%  (sem total gravado; o PIX pago, R$ 88,00, e o bruto)
--   X  12 propostas pagas de ex-clientes com bonus, percentual provado:
--        LISITON (8469): 19368, 19369, 19370, 19400, 19409, 19443 = 8%
--        cliente 6 (testes): 20508, 20792, 20890, 20916, 20960, 20961 = 99%
--   V  149 propostas de cliente com bonus HOJE, com o bonus vigente:
--        32 pagas — o total gravado bate com o vigente (19202, sem total
--        gravado, pelo PIX pago: R$ 1.913,34);
--        117 nao pagas (orcamento, aguardando, canceladas) — a linha registra o
--        percentual que a tela ja mostra; ate congelar no primeiro pagamento
--        (Fase 4), o salvar reescreve a linha.
--
-- O QUE MUDA NO QUE SE VE
--   So 20 propostas mudam de total na tela: as 8 D e as 12 X, que passam a
--   mostrar o que foi cobrado. Nas 149 V a tela ja usava esse percentual.
--   No banco, `cc__total_soberano_proposta` passa a descontar o bonus nas 169;
--   nas pagas ele fica igual ao total gravado (ou ao pago, quando nao ha total).
--   Isso destrava a edicao da 22930 e das outras pagas de cliente com bonus.
--
-- O QUE NAO E TOCADO
--   `propostas` (valor, valor_total, frete, status, updated_at), `pagamentos_v2`,
--   `conta_corrente_pendencias` e `movimento_credito` — conferidos antes e
--   depois nas 169. O trigger `tg_recalc_desconto_v4` dispara a cada linha, mas
--   `recalcular_proposta_v4` so devolve valores.
--   As 8 linhas legadas de propostas FORA da carga (14597, 15463, 15508, 15527,
--   15568, 16464 — clientes sem bonus hoje, orcamentos NOVO) ficam como estao.
--
-- TRAVAS (qualquer uma falha, nada e gravado)
--   a) a CHECK desconto_proposta_tabela_especial_valida existe; nao ha linha
--      TABELA_ESPECIAL ainda;
--   b) cada proposta existe, nao e avulsa e e do cliente listado; nas V o
--      percentual e o bonus vigente do cliente AGORA;
--   c) as linhas legadas das 169 sao exatamente as 15 listadas;
--   d) depois: 169 linhas, 15 removidas, propostas/pagamentos/Conta Corrente
--      intactos nas 169, `cc__total_soberano_proposta` igual ao de antes em
--      TODAS as outras propostas, e nas pagas igual ao total gravado (ou ao
--      pago) com tolerancia de R$ 0,02.
--
-- ROLLBACK
--   delete from public.desconto_proposta where tipo_desconto = 'TABELA_ESPECIAL';
--   e reinserir as 15 linhas legadas (copia delas em scratch/, feita antes).
-- ============================================================================

do $carga$
declare
  v_n            int;
  v_legado       integer[] := array[24,27,28,29,30,31,32,33,36,37,68,70,71,73,75];
  v_problemas    text;
begin
  -- ==========================================================================
  -- 0. PRE-CONDICOES
  -- ==========================================================================
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.desconto_proposta'::regclass
                    and conname = 'desconto_proposta_tabela_especial_valida') then
    raise exception 'aplique antes 20261001_desconto_tabela_especial_check';
  end if;
  if exists (select 1 from public.desconto_proposta where tipo_desconto = 'TABELA_ESPECIAL') then
    raise exception 'ja existe linha TABELA_ESPECIAL: a carga ja rodou?';
  end if;

  create temp table _lista (
    id_int     bigint primary key,
    id_cliente bigint not null,
    pct        numeric not null,
    origem     text not null,   -- D decisao | X ex-cliente com bonus | V bonus vigente
    paga       boolean not null
  ) on commit drop;

  insert into _lista (id_int, id_cliente, pct, origem, paga) values
    (12049,27401,3,'D',true),(14154,27401,3,'D',true),(14533,27401,0,'D',true),(14793,27401,3,'D',true),
    (14917,27401,3,'D',true),(18360,14,0,'D',true),(19348,27096,0,'D',true),(19508,51750,0,'D',true),
    (19368,8469,8,'X',true),(19369,8469,8,'X',true),(19370,8469,8,'X',true),(19400,8469,8,'X',true),
    (19409,8469,8,'X',true),(19443,8469,8,'X',true),(20508,6,99,'X',true),(20792,6,99,'X',true),
    (20890,6,99,'X',true),(20916,6,99,'X',true),(20960,6,99,'X',true),(20961,6,99,'X',true),
    (14008,11406,10,'V',false),(14145,14,10,'V',false),(14528,11406,10,'V',false),(16476,27401,5,'V',false),
    (16926,11406,10,'V',false),(17093,11406,10,'V',false),(17179,14,10,'V',false),(17189,14,10,'V',false),
    (17192,14,10,'V',false),(17419,14,10,'V',false),(17579,14,10,'V',false),(17628,14,10,'V',false),
    (17665,14,10,'V',false),(17754,14,10,'V',false),(17797,14,10,'V',false),(17798,14,10,'V',false),
    (17799,14,10,'V',false),(17823,14,10,'V',false),(17925,14,10,'V',false),(17951,14,10,'V',false),
    (17987,14,10,'V',false),(18039,14,10,'V',false),(18044,14,10,'V',false),(18087,27401,5,'V',true),
    (18088,14,10,'V',false),(18090,14,10,'V',false),(18091,14,10,'V',false),(18092,14,10,'V',false),
    (18093,14,10,'V',false),(18094,14,10,'V',false),(18095,14,10,'V',false),(18096,14,10,'V',false),
    (18149,14,10,'V',false),(18225,14,10,'V',false),(18359,14,10,'V',false),(18560,14,10,'V',false),
    (18636,14,10,'V',false),(18648,14,10,'V',false),(18733,14,10,'V',false),(18867,14,10,'V',false),
    (18869,14,10,'V',false),(18877,14,10,'V',false),(18894,14,10,'V',false),(18895,14,10,'V',false),
    (18909,14,10,'V',false),(18934,14,10,'V',false),(18938,14,10,'V',false),(18939,14,10,'V',false),
    (19004,14,10,'V',false),(19035,14,10,'V',false),(19087,14,10,'V',false),(19091,14,10,'V',false),
    (19202,27401,5,'V',true),(19237,11406,10,'V',false),(19269,11406,10,'V',false),(19359,14,10,'V',true),
    (19362,11406,10,'V',false),(19363,14,10,'V',false),(19376,14,10,'V',false),(19384,14,10,'V',false),
    (19432,14,10,'V',false),(19521,14,10,'V',true),(19639,11406,10,'V',false),(19714,14,10,'V',false),
    (19715,14,10,'V',false),(19733,14,10,'V',false),(19767,27401,5,'V',true),(19891,14,10,'V',false),
    (20144,14,10,'V',false),(20225,14,10,'V',false),(20259,14,10,'V',false),(20262,14,10,'V',false),
    (20389,11406,10,'V',false),(20416,27096,10,'V',false),(20421,27096,10,'V',false),(20596,14,10,'V',false),
    (20670,11406,10,'V',false),(20687,14,10,'V',false),(20713,14,10,'V',false),(20738,14,10,'V',false),
    (20784,14,10,'V',false),(20895,14,10,'V',false),(20896,14,10,'V',false),(20897,14,10,'V',false),
    (20898,14,10,'V',false),(21086,14,10,'V',false),(21106,11406,10,'V',false),(21138,27401,5,'V',true),
    (21202,27401,5,'V',true),(21214,14,10,'V',false),(21215,14,10,'V',false),(21261,11406,10,'V',false),
    (21322,27401,5,'V',true),(21330,27401,5,'V',true),(21341,14,10,'V',false),(21346,14,10,'V',false),
    (21373,14,10,'V',false),(21509,11406,10,'V',false),(21524,11406,10,'V',true),(21576,11406,10,'V',true),
    (21654,11406,10,'V',false),(21695,11406,10,'V',true),(21708,11406,10,'V',true),(21774,14,10,'V',false),
    (21795,27096,10,'V',false),(21825,11406,10,'V',true),(21831,14,10,'V',false),(21844,14,10,'V',false),
    (21866,11406,10,'V',true),(21909,11406,10,'V',false),(21967,14,10,'V',false),(22027,14,10,'V',false),
    (22066,14,10,'V',true),(22114,27401,5,'V',true),(22230,51750,10,'V',false),(22235,11406,10,'V',true),
    (22238,14,10,'V',false),(22267,11406,10,'V',false),(22302,27096,10,'V',true),(22305,11406,10,'V',true),
    (22323,50784,10,'V',true),(22388,11406,10,'V',false),(22414,14,10,'V',true),(22418,14,10,'V',false),
    (22528,11406,10,'V',true),(22574,14,10,'V',false),(22577,14,10,'V',false),(22587,11406,10,'V',false),
    (22588,11406,10,'V',true),(22593,27096,10,'V',true),(22600,14,10,'V',false),(22601,14,10,'V',false),
    (22603,14,10,'V',false),(22647,27401,5,'V',true),(22673,14,10,'V',false),(22679,20128,3,'V',true),
    (22697,11406,10,'V',true),(22720,11406,10,'V',false),(22723,11406,10,'V',false),(22743,11406,10,'V',true),
    (22760,14,10,'V',false),(22763,27401,5,'V',true),(22820,14,10,'V',false),(22821,14,10,'V',false),
    (22823,14,10,'V',false),(22908,14,10,'V',false),(22930,27401,5,'V',true),(22941,11406,10,'V',true),
    (22962,14,10,'V',false);

  select count(*) into v_n from _lista;
  if v_n <> 169 then raise exception 'a lista tem % propostas, esperado 169', v_n; end if;

  -- b) proposta existe, nao e avulsa, cliente confere; V = bonus vigente AGORA.
  select string_agg(l.id_int::text, ',') into v_problemas
    from _lista l
    left join public.propostas p on p.id_int = l.id_int
    left join public.clientes c on c.id_cliente = p.id_cliente
   where p.id_int is null
      or coalesce(p.is_avulso, false)
      or p.id_cliente is distinct from l.id_cliente
      or (l.origem = 'V' and l.pct is distinct from
            (case when coalesce(c.usa_preco_fixo, false) then 0
                  when coalesce(c.is_bonus, false) then coalesce(c.percentual_bunus, 0)
                  else 0 end)::numeric);
  if v_problemas is not null then
    raise exception 'propostas fora do esperado (avulsa, cliente ou bonus vigente mudou): %', v_problemas;
  end if;

  -- c) as legadas das 169 sao exatamente as 15 listadas.
  if (select array_agg(d.id order by d.id) from public.desconto_proposta d
       where d.tipo_desconto is distinct from 'DESCONTO_GERAL'
         and d.id_int in (select id_int from _lista)) is distinct from v_legado then
    raise exception 'as linhas legadas das propostas da carga mudaram';
  end if;

  -- ==========================================================================
  -- 1. O ANTES
  -- ==========================================================================
  create temp table _antes_prop on commit drop as
    select p.id_int, p.valor, p.valor_total, p.valor_frete, p.status_interno, p.updated_at
      from public.propostas p where p.id_int in (select id_int from _lista);

  create temp table _antes_fin on commit drop as
    select l.id_int,
           (select count(*) || '|' || coalesce(sum(valor), 0) || '|' || coalesce(string_agg(status || ':' || coalesce(confirmado::text, ''), ',' order by id), '')
              from public.pagamentos_v2 pv where pv.id_int = l.id_int) as cobrancas,
           (select count(*) from public.conta_corrente_pendencias cp where cp.id_int = l.id_int) as pendencias,
           (select count(*) from public.movimento_credito mc where mc.id_int = l.id_int) as movimentos
      from _lista l;

  create temp table _antes_sob on commit drop as
    select p.id_int, public.cc__total_soberano_proposta(p.id_int) as soberano from public.propostas p;

  -- ==========================================================================
  -- 2. A CARGA
  -- ==========================================================================
  delete from public.desconto_proposta
   where id = any (v_legado) and tipo_desconto is distinct from 'DESCONTO_GERAL';
  get diagnostics v_n = row_count;
  if v_n <> 15 then raise exception 'removidas % linhas legadas, esperado 15', v_n; end if;

  insert into public.desconto_proposta (id_int, tipo_desconto, valor_percentual, valor_nominal, descricao)
  select l.id_int, 'TABELA_ESPECIAL', l.pct, 0,
         case l.origem
           when 'D' then 'Bonus de tabela especial da venda: percentual provado pelo valor cobrado (carga de 01/10/2026)'
           when 'X' then 'Bonus de tabela especial da venda: percentual provado pelo valor cobrado; cliente sem bonus hoje (carga de 01/10/2026)'
           else          'Bonus de tabela especial vigente do cliente (carga de 01/10/2026)'
         end
    from _lista l;
  get diagnostics v_n = row_count;
  if v_n <> 169 then raise exception 'inseridas % linhas, esperado 169', v_n; end if;

  -- ==========================================================================
  -- 3. ASSERCOES
  -- ==========================================================================
  if exists (
    select 1 from _antes_prop a join public.propostas p using (id_int)
     where (a.valor, a.valor_total, a.valor_frete, a.status_interno, a.updated_at)
           is distinct from (p.valor, p.valor_total, p.valor_frete, p.status_interno, p.updated_at)
  ) then
    raise exception 'propostas mudou nas propostas da carga';
  end if;

  if exists (
    select 1 from _antes_fin a
     where a.cobrancas is distinct from
             (select count(*) || '|' || coalesce(sum(valor), 0) || '|' || coalesce(string_agg(status || ':' || coalesce(confirmado::text, ''), ',' order by id), '')
                from public.pagamentos_v2 pv where pv.id_int = a.id_int)
        or a.pendencias is distinct from (select count(*) from public.conta_corrente_pendencias cp where cp.id_int = a.id_int)
        or a.movimentos is distinct from (select count(*) from public.movimento_credito mc where mc.id_int = a.id_int)
  ) then
    raise exception 'cobrancas ou Conta Corrente mudaram nas propostas da carga';
  end if;

  select string_agg(s.id_int::text, ',') into v_problemas
    from _antes_sob s
   where s.id_int not in (select id_int from _lista)
     and s.soberano is distinct from public.cc__total_soberano_proposta(s.id_int);
  if v_problemas is not null then
    raise exception 'o total do banco mudou FORA da carga: %', v_problemas;
  end if;

  select string_agg(l.id_int::text || '=' || public.cc__total_soberano_proposta(l.id_int)::text, ',') into v_problemas
    from _lista l join public.propostas p using (id_int)
   where l.paga
     and abs(public.cc__total_soberano_proposta(l.id_int)
             - coalesce(round(p.valor_total::numeric, 2), public.cc__valor_pago(l.id_int))) > 0.02;
  if v_problemas is not null then
    raise exception 'pagas cujo total do banco nao bate com o cobrado: %', v_problemas;
  end if;

  raise notice 'ok: 169 linhas TABELA_ESPECIAL, 15 legadas removidas, nada mais tocado';
end
$carga$;
