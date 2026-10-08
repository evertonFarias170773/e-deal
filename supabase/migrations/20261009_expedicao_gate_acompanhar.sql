-- Pedido complementar, Fase 5 — o gate do ACOMPANHAR na Expedicao e a leitura dos grupos para o painel
--
-- Depende de: 20261008_pedidos_vinculos.sql (a tabela public.pedidos_vinculos).
--
-- O QUE E
--   Em um grupo ACOMPANHAR, nenhum pedido pode ser despachado (nem ter etiqueta ou prepostagem)
--   ate todos os membros ativos estarem prontos para expedir. Depois disso, cada um despacha e
--   gera a sua propria etiqueta, sem depender dos outros. Esta migration poe a regra NO BANCO,
--   e nao so na tela: qualquer caminho que grave `expedicoes.data_despacho` passa por ela.
--
-- A REGRA DE "PRONTO PARA EXPEDIR" MORA EM UM LUGAR SO
--   `public.pedido_pronto_para_expedir(id_int)`. Hoje e a mesma regra da E9: `status_interno =
--   'EXPEDICAO'`. Quem ja saiu (A RETIRAR, EM TRANSITO, ENTREGUE, RECEBIDO, ou com
--   `expedicoes.data_despacho` preenchida) conta como satisfeito. Para decidir outra coisa —
--   por exemplo exigir `expedicoes.data_pronto` — basta recriar ESSA funcao: o gate, o trigger,
--   as rotas e os pontos verde e ambar do painel leem dela.
--
-- O QUE ESTA MIGRATION CRIA
--   1. pedido_pronto_para_expedir(bigint) -> boolean ........ a regra acima
--   2. acompanhar_pendentes(bigint) -> jsonb ................ o gate: este pedido esta em grupo
--                                                             ACOMPANHAR ativo? Que outros membros
--                                                             ainda nao estao prontos?
--   3. vinculos_dos_pedidos(bigint[]) -> tabela ............. leitura em lote para o painel: os
--                                                             membros ativos dos grupos dos pedidos
--                                                             pedidos, com status e "pronto"
--   4. exp__trg_gate_acompanhar() + trigger trg_exp_gate_acompanhar em `expedicoes`:
--      recusa a passagem de `data_despacho` de NULO para PREENCHIDO quando o pedido esta em grupo
--      ACOMPANHAR ativo e algum outro membro ativo ainda nao esta pronto
--
-- QUEM LE O QUE
--   Todas sao SECURITY DEFINER com search_path fixo, sem acesso de `anon`. `authenticated` e
--   `service_role` executam. Nao ha checagem de permissao: so devolvem numero de pedido e
--   status, e a tabela `pedidos_vinculos` ja e legivel por qualquer `authenticated`.
--   As rotas `/api/expedicao/etiqueta` e `/api/expedicao/correios/prepostagem` consultam
--   `acompanhar_pendentes` e recusam com a lista de quem falta.
--
-- O QUE ESTE TRIGGER NAO FAZ (e e de proposito)
--   - So olha a transicao de `data_despacho` de NULO para PREENCHIDO. Qualquer outra gravacao em
--     `expedicoes` passa: "Marcar pronto" (data_pronto), peso, volumes, rastreio, coleta, entrega,
--     "Voltar status" (que LIMPA a data), rascunho do despacho.
--   - So olha grupos do tipo ACOMPANHAR. Pedido fora de grupo, e pedido em grupo COMPLEMENTO, nao
--     sao tocados: a E9 (despacho conjunto) e o gate COMPLEMENTO_SEGUE_PRINCIPAL ficam como estao.
--   - Membro CANCELADO nao trava ninguem (conta como se tivesse saido do grupo).
--   - Em `INSERT ... ON CONFLICT DO UPDATE` (o `upsert` do app) o trigger de INSERT dispara antes
--     da resolucao do conflito: por isso, no INSERT, ele le a linha que ja existe e so age se
--     `data_despacho` dela ainda for nulo.
--
-- ORDEM ENTRE OS TRIGGERS DE `expedicoes`
--   O unico outro e `trg_exp_trava_frete_despacho` (BEFORE INSERT OR UPDATE). O Postgres dispara
--   triggers do mesmo momento em ordem alfabetica: `trg_exp_gate_acompanhar` roda ANTES. Se o
--   gate recusar, a trava de frete nem chega a consumir uma liberacao; e se a trava de frete
--   recusasse depois, a transacao inteira volta. Nenhum depende do outro.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO altera `propostas`, `pedidos_vinculos`, nenhum trigger existente, nenhuma funcao
--   existente, frete, `valor_total`, NF-e nem a E9. NAO cria vinculo nenhum. NAO fecha grupos
--   (proposta de fechamento: fase seguinte).
--
-- VERIFICACAO (rodar depois de aplicar)
--
-- a) Funcoes e trigger:
--    SELECT proname, prosecdef, proconfig, proacl FROM pg_proc
--     WHERE proname IN ('pedido_pronto_para_expedir','acompanhar_pendentes','vinculos_dos_pedidos','exp__trg_gate_acompanhar');
--    SELECT tgname, tgenabled, pg_get_triggerdef(oid) FROM pg_trigger
--     WHERE tgrelid = 'public.expedicoes'::regclass AND NOT tgisinternal ORDER BY tgname;
--    Esperado: duas triggers (a nova e a trava de frete); funcoes definer, search_path fixo, sem anon.
--
-- b) Nada mudou fora disto: comparar md5(pg_get_functiondef) e ACL das funcoes existentes e
--    md5(pg_get_triggerdef) dos triggers existentes com o retrato de antes.
--
-- ROLLBACK
--   DROP TRIGGER trg_exp_gate_acompanhar ON public.expedicoes;
--   DROP FUNCTION public.exp__trg_gate_acompanhar();
--   DROP FUNCTION public.vinculos_dos_pedidos(bigint[]);
--   DROP FUNCTION public.acompanhar_pendentes(bigint);
--   DROP FUNCTION public.pedido_pronto_para_expedir(bigint);

-- ============================================================================
-- 1. A REGRA DE "PRONTO PARA EXPEDIR"
-- ============================================================================
create or replace function public.pedido_pronto_para_expedir(p_id_int bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select upper(coalesce(p.status_interno, '')) in ('EXPEDICAO', 'A RETIRAR', 'EM TRANSITO', 'ENTREGUE', 'RECEBIDO')
           or exists (select 1 from public.expedicoes e
                       where e.id_int = p.id_int and e.data_despacho is not null)
      from public.propostas p
     where p.id_int = p_id_int
  ), false);
$$;

revoke all on function public.pedido_pronto_para_expedir(bigint) from public, anon;
grant execute on function public.pedido_pronto_para_expedir(bigint) to authenticated, service_role;

comment on function public.pedido_pronto_para_expedir(bigint) is
  'A regra unica de "pronto para expedir": status EXPEDICAO, ou ja saiu (A RETIRAR, EM TRANSITO, ENTREGUE, RECEBIDO, ou data_despacho preenchida). Trocar a regra e recriar so esta funcao. Lida pelo gate do ACOMPANHAR, pelo trigger de expedicoes, pelas rotas da etiqueta e da prepostagem e pelo painel da Expedicao.';

-- ============================================================================
-- 2. O GATE: quem ainda falta no grupo ACOMPANHAR deste pedido
-- ============================================================================
create or replace function public.acompanhar_pendentes(p_id_int bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_grupo uuid;
  v_pend  jsonb;
begin
  select v.grupo_id into v_grupo
    from public.pedidos_vinculos v
   where v.id_int = p_id_int and v.tipo = 'ACOMPANHAR' and v.saiu_em is null;

  if v_grupo is null then
    return jsonb_build_object('em_grupo', false, 'grupo_id', null, 'pendentes', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id_int', m.id_int, 'status', p.status_interno) order by m.ordem), '[]'::jsonb)
    into v_pend
    from public.pedidos_vinculos m
    join public.propostas p on p.id_int = m.id_int
   where m.grupo_id = v_grupo
     and m.saiu_em is null
     and m.id_int <> p_id_int
     and upper(coalesce(p.status_interno, '')) not in ('CANCELADO', 'CANCELADA')
     and not public.pedido_pronto_para_expedir(m.id_int);

  return jsonb_build_object('em_grupo', true, 'grupo_id', v_grupo, 'pendentes', v_pend);
end;
$$;

revoke all on function public.acompanhar_pendentes(bigint) from public, anon;
grant execute on function public.acompanhar_pendentes(bigint) to authenticated, service_role;

comment on function public.acompanhar_pendentes(bigint) is
  'Gate do ACOMPANHAR. Devolve {em_grupo, grupo_id, pendentes:[{id_int,status}]}: os OUTROS membros ativos do grupo ACOMPANHAR deste pedido que ainda nao estao prontos para expedir (pedido_pronto_para_expedir). Membro cancelado nao conta. Usado pelo trigger de expedicoes e pelas rotas da etiqueta e da prepostagem.';

-- ============================================================================
-- 3. A LEITURA EM LOTE PARA O PAINEL DA EXPEDICAO
-- ============================================================================
create or replace function public.vinculos_dos_pedidos(p_ids bigint[])
returns table (
  consulta       bigint,
  grupo_id       uuid,
  tipo           text,
  id_int         bigint,
  ordem          integer,
  status_interno text,
  pronto         boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.id_int                                     as consulta,
         m.grupo_id,
         m.tipo,
         m.id_int,
         m.ordem,
         p.status_interno,
         public.pedido_pronto_para_expedir(m.id_int)  as pronto
    from public.pedidos_vinculos v
    join public.pedidos_vinculos m
      on m.grupo_id = v.grupo_id and m.saiu_em is null
    join public.propostas p
      on p.id_int = m.id_int
   where v.id_int = any (p_ids)
     and v.saiu_em is null
     and upper(coalesce(p.status_interno, '')) not in ('CANCELADO', 'CANCELADA')
   order by v.id_int, m.tipo, m.ordem;
$$;

revoke all on function public.vinculos_dos_pedidos(bigint[]) from public, anon;
grant execute on function public.vinculos_dos_pedidos(bigint[]) to authenticated, service_role;

comment on function public.vinculos_dos_pedidos(bigint[]) is
  'Leitura em lote do painel da Expedicao: para cada pedido consultado, todos os membros ativos dos grupos dele (COMPLEMENTO e ACOMPANHAR), com status e se estao prontos para expedir. Pedido cancelado nao aparece. So leitura.';

-- ============================================================================
-- 4. O TRIGGER EM expedicoes
-- ============================================================================
create or replace function public.exp__trg_gate_acompanhar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes timestamptz;
  v_gate  jsonb;
  v_lista text;
begin
  -- so interessa quando a gravacao PREENCHE a data de despacho
  if NEW.data_despacho is null then
    return NEW;
  end if;

  -- ... e so a passagem de nulo para preenchido
  if TG_OP = 'UPDATE' then
    v_antes := OLD.data_despacho;
  else
    -- o upsert do app entra por INSERT mesmo quando a linha ja existe
    select e.data_despacho into v_antes from public.expedicoes e where e.id_int = NEW.id_int;
  end if;
  if v_antes is not null then
    return NEW;
  end if;

  v_gate := public.acompanhar_pendentes(NEW.id_int);
  if jsonb_array_length(v_gate -> 'pendentes') = 0 then
    return NEW;
  end if;

  select string_agg('#' || (x ->> 'id_int') || ' (' || coalesce(nullif(x ->> 'status', ''), 'sem status') || ')', ', ')
    into v_lista
    from jsonb_array_elements(v_gate -> 'pendentes') x;

  raise exception 'ACOMPANHAR_GATE: o pedido #% esta em um grupo Acompanhar e so despacha quando todos os pedidos do grupo estiverem prontos para expedir. Faltam: %.',
    NEW.id_int, v_lista
    using errcode = 'P0001';
end;
$$;

revoke all on function public.exp__trg_gate_acompanhar() from public, anon;

comment on function public.exp__trg_gate_acompanhar() is
  'Trigger de expedicoes: recusa a passagem de data_despacho de nulo para preenchido quando o pedido esta em grupo ACOMPANHAR ativo e algum outro membro ativo ainda nao esta pronto para expedir. Nao olha COMPLEMENTO, pedido fora de grupo nem qualquer outra gravacao.';

create trigger trg_exp_gate_acompanhar
  before insert or update of data_despacho on public.expedicoes
  for each row
  execute function public.exp__trg_gate_acompanhar();
