-- Pedido complementar, Fase 2 — tabela public.pedidos_vinculos e as funcoes que a escrevem
--
-- Mapa e decisoes: conversa de 08/10/2026 (mapeamento "Criar Complemento" e "Acompanhar Pedido").
-- Regra do complemento hoje: docs/business/PEDIDO-COMPLEMENTAR.md.
--
-- O QUE E
--   Um GRUPO de pedidos: N pedidos ligados, com uma ordem (o primeiro e a referencia) e um
--   tipo. COMPLEMENTO = pedidos que saem na mesma caixa, com frete pela diferenca.
--   ACOMPANHAR = pedidos independentes que esperam uns pelos outros na Expedicao.
--   Um pedido entra em no maximo UM grupo de cada tipo ao mesmo tempo (indice unico parcial),
--   entao pode ser COMPLEMENTO e ACOMPANHAR ao mesmo tempo, mas nao dois grupos do mesmo tipo.
--
-- ESTA E SO A ESTRUTURA. NADA LE ESTA TABELA AINDA
--   Nenhuma tela, rota, trigger ou regra consulta `pedidos_vinculos` nesta fase, e nenhuma
--   funcao existente a escreve. O comportamento do sistema nao muda: o complemento continua
--   sendo `propostas.id_int_pedido_principal` (ponteiro 1 para 1), que esta migration NAO toca.
--   As duas funcoes novas ainda nao tem chamador.
--
-- POR QUE UMA TABELA, E NAO UMA COLUNA EM `propostas`
--   Gravar em `propostas` recarimba `updated_at` (muda a janela de 15 dias da lista de Pedidos)
--   e dispara `etapa_arte_por_proposta`, a trigger deferida do parceiro de imposicao, que roda
--   em QUALQUER UPDATE da tabela. O "Acompanhar" grava na hora e nao pode fazer nada disso.
--
-- O QUE ESTA MIGRATION FAZ
--   1. Cria `public.pedidos_vinculos`, com RLS ligada, SELECT para `authenticated` e SEM
--      policy de escrita. Escrita so pelas funcoes SECURITY DEFINER abaixo (nem `authenticated`
--      nem `service_role` tem INSERT, UPDATE ou DELETE na tabela). `anon` nao tem nada.
--   2. Cria `vincular_pedidos(tipo, ids[])`: cria ou amplia o grupo. Idempotente.
--   3. Cria `soltar_pedido_vinculo(id_int, tipo, motivo)`: marca a saida; quando sobra 1, o
--      grupo se desfaz.
--   4. Copia para a tabela as relacoes de complemento que ja existem em
--      `propostas.id_int_pedido_principal` (so LEITURA de `propostas`).
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO altera `propostas`, `expedicoes`, `cotacao_frete`, `pagamentos_v2`, a coluna
--   `id_int_pedido_principal`, nenhum trigger, nenhuma funcao existente, nenhuma view, nenhuma
--   policy de outra tabela. NAO toca em frete, `valor_total`, Expedicao, etiqueta nem NF-e.
--   NAO cria trigger nenhum nem liga auditoria na tabela nova.
--   NAO altera `cc__assert_permissao`.
--   A chave estrangeira para `propostas(id_int)` cria triggers internos de integridade do
--   proprio Postgres na tabela referenciada, como o ledger `complementos_frete` ja faz: eles so
--   agem se alguem tentar APAGAR uma proposta que tenha linha aqui (ON DELETE RESTRICT).
--
-- PERMISSOES (mesmo mecanismo das funcoes do complemento: `cc__assert_permissao(auth.uid(), ...)`)
--   vincular_pedidos COMPLEMENTO .... `propostas.complementar`
--   vincular_pedidos ACOMPANHAR ..... `propostas.edit`, ou `expedicao.processar`.
--                                     (Escolha desta migration; o dono confirma antes de alguma
--                                     tela chamar a funcao. Trocar e so recriar a funcao.)
--   soltar_pedido_vinculo ........... quem criou a ligacao solta com a permissao com que criou;
--                                     TERCEIRO exige `expedicao.admin`. Ligacao copiada do
--                                     passado (sem autor) conta como de terceiro.
--   `cc__assert_permissao` aprova super administrador e administrador (`is_admin`) mesmo sem a
--   chave no perfil, e recusa quando nao ha usuario (`auth.uid()` nulo, que e o caso de
--   `service_role`: a funcao e executavel por ele no ACL, igual as do complemento, mas nao
--   consegue passar da permissao).
--
-- REGRAS DE `vincular_pedidos` (cada recusa tem codigo proprio na mensagem)
--   VINC_TIPO ........ tipo diferente de COMPLEMENTO e ACOMPANHAR
--   VINC_IDS ......... lista vazia, com valor nulo, com menos de 2 pedidos distintos ou com mais de 50
--   VINC_PEDIDO ...... pedido que nao existe
--   VINC_CANCELADO ... pedido cancelado
--   VINC_DESPACHADO .. `expedicoes.data_despacho` preenchida, ou status A RETIRAR, EM TRANSITO,
--                      ENTREGUE ou RECEBIDO
--   VINC_AVULSA ...... pedido avulso (nao vai para a Expedicao; o grupo ficaria parado)
--   VINC_CLIENTE ..... o primeiro id da lista e o pedido de ORIGEM; os demais precisam ser do
--                      mesmo cliente dele (COMPLEMENTO) ou do mesmo cliente OU do mesmo socio
--                      pagador, `id_faturado` (ACOMPANHAR)
--   VINC_GRUPOS ...... os pedidos ja estao em grupos diferentes do mesmo tipo (unir grupos nao existe)
--   A ORDEM e a de entrada no grupo: grupo novo segue a criacao dos pedidos (created_at, id_int);
--   quem entra depois recebe a proxima ordem.
--
-- VERIFICACAO (rodar depois de aplicar)
--
-- a) A tabela e a RLS:
--    SELECT relrowsecurity, relacl FROM pg_class WHERE oid = 'public.pedidos_vinculos'::regclass;
--    Esperado: true; authenticated e service_role so com `r` (SELECT); nada para anon.
--
-- b) As funcoes:
--    SELECT proname, prosecdef, proconfig, proacl FROM pg_proc
--     WHERE proname IN ('vincular_pedidos','soltar_pedido_vinculo');
--    Esperado: true; {search_path=public, pg_temp}; sem anon no ACL.
--
-- c) O backfill:
--    SELECT grupo_id, id_int, ordem, saiu_em, saiu_motivo FROM public.pedidos_vinculos ORDER BY grupo_id, ordem;
--    Esperado (08/10/2026): 8 linhas, 4 grupos; os pares com pedido CANCELADO ou ENTREGUE saem
--    com saiu_motivo = 'histórico'; os demais ficam ativos.
--
-- d) Nada mudou fora da tabela nova: comparar md5(pg_get_triggerdef) de todos os triggers e
--    md5(pg_get_functiondef) e ACL das funcoes existentes com o retrato de antes.
--
-- ROLLBACK
--   DROP FUNCTION public.soltar_pedido_vinculo(bigint, text, text);
--   DROP FUNCTION public.vincular_pedidos(text, bigint[]);
--   DROP TABLE public.pedidos_vinculos;
--   Nao ha dado de outro lugar que dependa disto nesta fase: so se perdem as ligacoes gravadas
--   aqui (as 8 do backfill, que se refazem a partir de `propostas.id_int_pedido_principal`).

-- ============================================================================
-- 1. A TABELA
-- ============================================================================
create table public.pedidos_vinculos (
  id               bigint generated always as identity primary key,
  grupo_id         uuid        not null,
  tipo             text        not null,
  id_int           bigint      not null references public.propostas (id_int) on delete restrict,
  ordem            integer     not null,
  criado_em        timestamptz not null default now(),
  criado_por       uuid,
  criado_por_nome  text,
  saiu_em          timestamptz,
  saiu_por         uuid,
  saiu_por_nome    text,
  saiu_motivo      text,
  constraint pedidos_vinculos_tipo_ck  check (tipo in ('COMPLEMENTO', 'ACOMPANHAR')),
  constraint pedidos_vinculos_ordem_ck check (ordem >= 1),
  -- saiu_em e saiu_motivo andam juntos: quem sai tem motivo, quem esta ativo nao tem nenhum.
  -- saiu_por pode faltar so quando a saida e historica (backfill) e nao ha usuario.
  constraint pedidos_vinculos_saida_ck check (
    (saiu_em is null and saiu_motivo is null and saiu_por is null)
    or (saiu_em is not null and nullif(btrim(saiu_motivo), '') is not null)
  ),
  -- a ordem nunca se repete dentro do grupo, nem entre ativos e quem ja saiu
  constraint pedidos_vinculos_grupo_ordem_uk unique (grupo_id, ordem)
);

-- Um pedido em no maximo um grupo de cada tipo, entre os ativos.
create unique index pedidos_vinculos_pedido_tipo_ativo_uk
  on public.pedidos_vinculos (id_int, tipo)
  where saiu_em is null;

create index pedidos_vinculos_grupo_idx  on public.pedidos_vinculos (grupo_id);
create index pedidos_vinculos_pedido_idx on public.pedidos_vinculos (id_int);

comment on table public.pedidos_vinculos is
  'Grupos de pedidos (COMPLEMENTO = mesma caixa, frete pela diferenca; ACOMPANHAR = pedidos independentes que esperam uns pelos outros). Uma linha por pedido por entrada no grupo; saiu_em preenchido = ja saiu. Escrita so por vincular_pedidos e soltar_pedido_vinculo. Fase 2 do pedido complementar: ainda nao e lida por tela nem rota.';
comment on column public.pedidos_vinculos.grupo_id is 'Identifica o grupo. Todos os membros de um grupo tem o mesmo tipo.';
comment on column public.pedidos_vinculos.ordem is 'Ordem de entrada no grupo, a partir de 1. 1 e a referencia (no COMPLEMENTO, o pedido principal). Nunca se repete no grupo.';
comment on column public.pedidos_vinculos.saiu_em is 'Preenchido quando o pedido deixou o grupo. Nulo = ativo.';
comment on column public.pedidos_vinculos.saiu_motivo is 'Obrigatorio quando saiu_em esta preenchido. "histórico" = linha copiada de propostas.id_int_pedido_principal cujo pedido ja estava cancelado ou entregue.';

-- ============================================================================
-- 2. RLS E ACESSO: SELECT para authenticated, escrita so pelas funcoes abaixo
-- ============================================================================
alter table public.pedidos_vinculos enable row level security;

create policy pedidos_vinculos_select_authenticated
  on public.pedidos_vinculos
  for select
  to authenticated
  using (true);

-- Sem policy de INSERT, UPDATE e DELETE. Alem do RLS, tira TODOS os privilegios e devolve so o
-- SELECT (os default privileges do schema public dariam ALL a authenticated e service_role).
revoke all on public.pedidos_vinculos from public, anon, authenticated, service_role;
grant select on public.pedidos_vinculos to authenticated, service_role;

-- ============================================================================
-- 3. vincular_pedidos
-- ============================================================================
create or replace function public.vincular_pedidos(
  p_tipo text,
  p_ids  bigint[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_tipo       text := upper(btrim(coalesce(p_tipo, '')));
  v_ids        bigint[];
  v_origem     bigint;
  v_ref        record;
  v_ped        record;
  v_faltam     bigint[];
  v_grupos     uuid[];
  v_grupo      uuid;
  v_ordem      integer;
  v_autor_nome text;
  v_novos      bigint[] := '{}';
  v_ja         bigint[] := '{}';
  v_id         bigint;
begin
  -- 1. tipo
  if v_tipo not in ('COMPLEMENTO', 'ACOMPANHAR') then
    raise exception 'VINC_TIPO: tipo "%" invalido; use COMPLEMENTO ou ACOMPANHAR', coalesce(p_tipo, '');
  end if;

  -- 2. permissao, pelo mesmo mecanismo das funcoes do complemento
  if v_tipo = 'COMPLEMENTO' then
    perform public.cc__assert_permissao(v_uid, 'propostas.complementar');
  else
    begin
      perform public.cc__assert_permissao(v_uid, 'propostas.edit');
    exception when insufficient_privilege then
      perform public.cc__assert_permissao(v_uid, 'expedicao.processar');
    end;
  end if;

  -- 3. a lista de pedidos; o primeiro e a origem
  if p_ids is null
     or coalesce(array_length(p_ids, 1), 0) = 0
     or exists (select 1 from unnest(p_ids) x where x is null) then
    raise exception 'VINC_IDS: informe os pedidos a vincular, sem valores vazios';
  end if;
  v_origem := p_ids[1];
  select coalesce(array_agg(distinct x order by x), '{}') into v_ids from unnest(p_ids) x;
  if coalesce(array_length(v_ids, 1), 0) < 2 then
    raise exception 'VINC_IDS: um grupo precisa de pelo menos dois pedidos distintos';
  end if;
  if array_length(v_ids, 1) > 50 then
    raise exception 'VINC_IDS: no maximo 50 pedidos por chamada (recebidos %)', array_length(v_ids, 1);
  end if;

  -- 4. serializa chamadas concorrentes sobre os mesmos pedidos, sem travar `propostas`
  foreach v_id in array v_ids loop
    perform pg_advisory_xact_lock(hashtextextended('pedidos_vinculos:' || v_id::text, 0));
  end loop;

  -- 5. os pedidos existem
  select array(
           select x from unnest(v_ids) x
            where not exists (select 1 from public.propostas p where p.id_int = x)
         ) into v_faltam;
  if coalesce(array_length(v_faltam, 1), 0) > 0 then
    raise exception 'VINC_PEDIDO: pedido(s) % nao encontrado(s)', array_to_string(v_faltam, ', ');
  end if;

  select p.id_int, p.id_cliente, p.id_faturado
    into v_ref
    from public.propostas p
   where p.id_int = v_origem;

  -- 6. cada pedido: nao cancelado, nao despachado, nao avulso, e do cliente certo
  for v_ped in
    select p.id_int, p.id_cliente, p.id_faturado,
           upper(coalesce(p.status_interno, '')) as st,
           coalesce(p.is_avulso, false) as avulso,
           exists (select 1 from public.expedicoes e
                    where e.id_int = p.id_int and e.data_despacho is not null) as despachado
      from public.propostas p
     where p.id_int = any (v_ids)
     order by p.id_int
  loop
    if v_ped.st in ('CANCELADO', 'CANCELADA') then
      raise exception 'VINC_CANCELADO: o pedido #% esta cancelado e nao entra em grupo', v_ped.id_int;
    end if;
    if v_ped.despachado or v_ped.st in ('A RETIRAR', 'EM TRANSITO', 'ENTREGUE', 'RECEBIDO') then
      raise exception 'VINC_DESPACHADO: o pedido #% ja foi despachado (status %) e nao entra em grupo', v_ped.id_int, v_ped.st;
    end if;
    if v_ped.avulso then
      raise exception 'VINC_AVULSA: o pedido #% e avulso, nao vai para a Expedicao e nao entra em grupo', v_ped.id_int;
    end if;

    if v_ped.id_int <> v_origem then
      if v_tipo = 'COMPLEMENTO' then
        if v_ped.id_cliente is null or v_ped.id_cliente is distinct from v_ref.id_cliente then
          raise exception 'VINC_CLIENTE: o pedido #% nao e do mesmo cliente do pedido #%', v_ped.id_int, v_origem;
        end if;
      else
        if not (v_ped.id_cliente is not null and v_ped.id_cliente = v_ref.id_cliente)
           and not (v_ped.id_faturado is not null and v_ped.id_faturado = v_ref.id_faturado) then
          raise exception 'VINC_CLIENTE: o pedido #% nao e do mesmo cliente nem do mesmo socio pagador do pedido #%', v_ped.id_int, v_origem;
        end if;
      end if;
    end if;
  end loop;

  -- 7. grupo: novo, ou o que ja existe para algum dos pedidos
  select coalesce(array_agg(distinct v.grupo_id), '{}')
    into v_grupos
    from public.pedidos_vinculos v
   where v.tipo = v_tipo
     and v.saiu_em is null
     and v.id_int = any (v_ids);

  if coalesce(array_length(v_grupos, 1), 0) > 1 then
    raise exception 'VINC_GRUPOS: os pedidos informados ja estao em % grupos diferentes do tipo %; unir grupos nao e permitido',
      array_length(v_grupos, 1), v_tipo;
  end if;

  if coalesce(array_length(v_grupos, 1), 0) = 0 then
    v_grupo := gen_random_uuid();
    v_ordem := 0;
  else
    v_grupo := v_grupos[1];
    select coalesce(max(v.ordem), 0) into v_ordem from public.pedidos_vinculos v where v.grupo_id = v_grupo;
  end if;

  select u.nome_usuario into v_autor_nome from public.usuarios u where u.user_id = v_uid;

  -- 8. entra quem ainda nao esta; repetir nao duplica
  for v_ped in
    select p.id_int
      from public.propostas p
     where p.id_int = any (v_ids)
     order by p.created_at, p.id_int
  loop
    if exists (select 1 from public.pedidos_vinculos v
                where v.grupo_id = v_grupo and v.id_int = v_ped.id_int and v.saiu_em is null) then
      v_ja := v_ja || v_ped.id_int::bigint;
    else
      v_ordem := v_ordem + 1;
      insert into public.pedidos_vinculos (grupo_id, tipo, id_int, ordem, criado_por, criado_por_nome)
      values (v_grupo, v_tipo, v_ped.id_int, v_ordem, v_uid, v_autor_nome);
      v_novos := v_novos || v_ped.id_int::bigint;
    end if;
  end loop;

  return jsonb_build_object(
    'grupo_id', v_grupo,
    'tipo', v_tipo,
    'criados', to_jsonb(v_novos),
    'ja_estavam', to_jsonb(v_ja),
    'membros', (
      select coalesce(jsonb_agg(jsonb_build_object('id_int', m.id_int, 'ordem', m.ordem) order by m.ordem), '[]'::jsonb)
        from public.pedidos_vinculos m
       where m.grupo_id = v_grupo and m.saiu_em is null
    )
  );
end;
$$;

revoke all on function public.vincular_pedidos(text, bigint[]) from public, anon;
grant execute on function public.vincular_pedidos(text, bigint[]) to authenticated, service_role;

comment on function public.vincular_pedidos(text, bigint[]) is
  'Cria ou amplia um grupo de pedidos (COMPLEMENTO ou ACOMPANHAR). O primeiro id e o pedido de origem. Idempotente. Fase 2 do pedido complementar: sem chamador ainda.';

-- ============================================================================
-- 4. soltar_pedido_vinculo
-- ============================================================================
create or replace function public.soltar_pedido_vinculo(
  p_id_int bigint,
  p_tipo   text,
  p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_tipo       text := upper(btrim(coalesce(p_tipo, '')));
  v_motivo     text := btrim(coalesce(p_motivo, ''));
  v_row        public.pedidos_vinculos%rowtype;
  v_autor_nome text;
  v_restam     integer;
  v_ultimo     bigint;
  v_desfeito   boolean := false;
begin
  -- 1. usuario, tipo e motivo
  if v_uid is null then
    raise exception 'AUTH: usuario nao autenticado' using errcode = '28000';
  end if;
  if v_tipo not in ('COMPLEMENTO', 'ACOMPANHAR') then
    raise exception 'VINC_TIPO: tipo "%" invalido; use COMPLEMENTO ou ACOMPANHAR', coalesce(p_tipo, '');
  end if;
  if v_motivo = '' then
    raise exception 'VINC_MOTIVO: informe o motivo para soltar o pedido do grupo';
  end if;

  -- 2. a ligacao ativa deste pedido
  perform pg_advisory_xact_lock(hashtextextended('pedidos_vinculos:' || p_id_int::text, 0));
  select * into v_row
    from public.pedidos_vinculos v
   where v.id_int = p_id_int and v.tipo = v_tipo and v.saiu_em is null
   for update;
  if not found then
    raise exception 'VINC_NAO_VINCULADO: o pedido #% nao esta em nenhum grupo ativo do tipo %', p_id_int, v_tipo;
  end if;

  -- 3. permissao: quem criou a ligacao solta com a permissao com que criou; terceiro exige
  --    `expedicao.admin`. Ligacao sem autor (copiada do passado) conta como de terceiro.
  if v_row.criado_por is not null and v_row.criado_por = v_uid then
    if v_tipo = 'COMPLEMENTO' then
      perform public.cc__assert_permissao(v_uid, 'propostas.complementar');
    else
      begin
        perform public.cc__assert_permissao(v_uid, 'propostas.edit');
      exception when insufficient_privilege then
        perform public.cc__assert_permissao(v_uid, 'expedicao.processar');
      end;
    end if;
  else
    perform public.cc__assert_permissao(v_uid, 'expedicao.admin');
  end if;

  select u.nome_usuario into v_autor_nome from public.usuarios u where u.user_id = v_uid;

  -- 4. sai o pedido
  update public.pedidos_vinculos
     set saiu_em       = now(),
         saiu_por      = v_uid,
         saiu_por_nome = v_autor_nome,
         saiu_motivo   = v_motivo
   where id = v_row.id;

  -- 5. o grupo some quando sobra um so
  select count(*) into v_restam
    from public.pedidos_vinculos v
   where v.grupo_id = v_row.grupo_id and v.saiu_em is null;

  if v_restam <= 1 then
    v_desfeito := true;
    select v.id_int into v_ultimo
      from public.pedidos_vinculos v
     where v.grupo_id = v_row.grupo_id and v.saiu_em is null;
    if v_ultimo is not null then
      update public.pedidos_vinculos
         set saiu_em       = now(),
             saiu_por      = v_uid,
             saiu_por_nome = v_autor_nome,
             saiu_motivo   = 'Grupo desfeito: restou um membro (saida do #' || p_id_int::text || ')'
       where grupo_id = v_row.grupo_id and saiu_em is null;
    end if;
  end if;

  return jsonb_build_object(
    'grupo_id', v_row.grupo_id,
    'tipo', v_tipo,
    'id_int', p_id_int,
    'grupo_desfeito', v_desfeito,
    'solto_junto', case when v_ultimo is null then '[]'::jsonb else to_jsonb(array[v_ultimo]) end
  );
end;
$$;

revoke all on function public.soltar_pedido_vinculo(bigint, text, text) from public, anon;
grant execute on function public.soltar_pedido_vinculo(bigint, text, text) to authenticated, service_role;

comment on function public.soltar_pedido_vinculo(bigint, text, text) is
  'Tira um pedido de um grupo, com motivo. Quem criou a ligacao solta com a permissao com que criou; terceiro exige expedicao.admin. O grupo se desfaz quando sobra um membro. Fase 2 do pedido complementar: sem chamador ainda.';

-- ============================================================================
-- 5. BACKFILL: as relacoes de complemento que ja existem
-- ============================================================================
-- So LE `propostas`; escreve so na tabela nova. Principal = ordem 1, complementos = 2, 3...
-- Membro CANCELADO ou ENTREGUE ja entra com saida e motivo "histórico". Se o grupo ficar com
-- um membro ativo so, ele tambem sai (um grupo de um nao existe). So roda com a tabela vazia.
do $backfill$
declare
  v_inseridas integer := 0;
  v_fechadas  integer := 0;
begin
  if exists (select 1 from public.pedidos_vinculos) then
    return;
  end if;

  with relacoes as (
    select c.id_int as compl, c.id_int_pedido_principal as princ, c.created_at as criado
      from public.propostas c
     where c.id_int_pedido_principal is not null
  ),
  grupos as (
    select r.princ, gen_random_uuid() as grupo_id, min(r.criado) as criado
      from relacoes r
     group by r.princ
  ),
  membros as (
    select g.grupo_id, g.princ as id_int, 1 as ordem, g.criado
      from grupos g
    union all
    select g.grupo_id, r.compl,
           1 + (row_number() over (partition by r.princ order by r.criado, r.compl))::integer,
           r.criado
      from relacoes r
      join grupos g on g.princ = r.princ
  )
  insert into public.pedidos_vinculos (grupo_id, tipo, id_int, ordem, criado_em, saiu_em, saiu_motivo)
  select m.grupo_id, 'COMPLEMENTO', m.id_int, m.ordem, m.criado,
         case when upper(coalesce(p.status_interno, '')) in ('CANCELADO', 'CANCELADA', 'ENTREGUE') then now() end,
         case when upper(coalesce(p.status_interno, '')) in ('CANCELADO', 'CANCELADA', 'ENTREGUE') then 'histórico' end
    from membros m
    join public.propostas p on p.id_int = m.id_int;
  get diagnostics v_inseridas = row_count;

  update public.pedidos_vinculos v
     set saiu_em     = now(),
         saiu_motivo = 'histórico: restou um membro'
   where v.saiu_em is null
     and v.grupo_id in (
       select g.grupo_id
         from public.pedidos_vinculos g
        where g.saiu_em is null
        group by g.grupo_id
       having count(*) = 1
     );
  get diagnostics v_fechadas = row_count;

  raise notice 'pedidos_vinculos: % linha(s) copiada(s) de propostas.id_int_pedido_principal; % fechada(s) por restar um membro', v_inseridas, v_fechadas;
end;
$backfill$;
