-- Trava de ADM na data e na hora de entrega
--
-- O QUE E
--   Uma funcao de trigger e duas triggers BEFORE UPDATE:
--
--     public.fn_prazo_entrega_exige_permissao()   trigger, SECURITY INVOKER
--     trg_prazo_exige_adm  BEFORE UPDATE ON public.propostas_os
--     trg_prazo_exige_adm  BEFORE UPDATE ON public.propostas_os_setores
--
--   Se `propostas_os.data_termino`, `propostas_os_setores.prazo` ou
--   `propostas_os_setores.hora` MUDAREM de um valor ja gravado para outro, e quem
--   escreve nao tiver a permissao `pedidos.edit_data`, o UPDATE e recusado com
--   mensagem em PT-BR.
--
-- POR QUE
--   A data de entrega e uma promessa ao cliente. Ate agora qualquer autenticado
--   podia reescreve-la — pela tela ou direto pelo PostgREST, que aceita
--   `PATCH /propostas_os?id_int=eq.X` de qualquer sessao logada. A tela ja tinha
--   uma trava (`lockDate`, BoletimFormPage.tsx:158), mas trava de tela e
--   sugestao: quem manda a requisicao na mao passa por cima.
--
--   Esta migration poe a mesma regra onde ela vale para todo mundo.
--
-- ============================================================================
-- COMO O ADM E IDENTIFICADO — e por que NAO por `is_admin`
-- ============================================================================
--   A permissao usada e `pedidos.edit_data`, que JA EXISTE no projeto: esta na
--   lista do perfil "Administrador" (public.perfis id 2) e e a mesma chave que o
--   front ja consulta em BoletimFormPage.tsx:155. Nao inventei vocabulario.
--
--   Quem decide e `public.cc__assert_permissao(uid, perm)`, que ja existe e ja e
--   a regra do projeto. Ela responde nesta ordem:
--     1. is_super_adm  -> passa
--     2. perfil ativo cujas `permissoes` contenham '*' ou a chave -> passa
--     3. is_admin      -> passa
--     4. senao         -> exceção
--
--   POR QUE NAO `usuarios.is_admin` DIRETO: ha usuario com perfil
--   "Administrador" e `is_admin = false` (Celi Santana, medido em 08/09/2026).
--   Olhar so a coluna bloquearia quem o cadastro trata como administrador. O
--   perfil e a fonte mais nova; a coluna e o fallback legado. `cc__assert_permissao`
--   ja concilia as duas, e replicar isso aqui criaria uma segunda regra de
--   permissao para divergir depois.
--
--   POR QUE NAO `public.is_admin()`: ELA ESTA QUEBRADA. O corpo dela e
--     select coalesce((select p.is_admin from public.perfis p
--                       where p.user_id = auth.uid()), false)
--   e `public.perfis` NAO TEM `user_id` nem `is_admin` — quem tem e
--   `public.usuarios`. Chamar `select public.is_admin()` hoje devolve
--   ERRO 42703, "column p.is_admin does not exist" (verificado em 08/09/2026).
--   Usa-la aqui faria TODO UPDATE falhar. Esta migration NAO a conserta: ela nao
--   tem chamador conhecido e consertar de carona e outra decisao.
--
--   POR QUE NAO `osqr__has_permissao`: mesma semantica, mas o EXECUTE dela e so
--   de `postgres` e `service_role` — `authenticated` NAO tem. Chamada de uma
--   trigger SECURITY INVOKER, ela falharia com 42501 para todo usuario logado. E
--   conceder EXECUTE esta fora do que esta rodada autoriza.
--
-- ============================================================================
-- O QUE A TRAVA NAO IMPEDE, DE PROPOSITO
-- ============================================================================
--   1. INSERT. A trigger e BEFORE UPDATE apenas. Abrir a OS e o boletim de um
--      setor continua livre para quem hoje ja faz isso.
--
--   2. PREENCHER O QUE ESTAVA NULO. `NULL -> valor` passa sem permissao. Nulo
--      nao e "valor ja gravado": e ausencia, e preenche-la e a propria criacao
--      automatica que a especificacao manda preservar.
--
--      Isto NAO e detalhe. O espelhamento por `id_int`
--      (`espelharPrazoNosSetores`, boletim-setores.service.ts) grava prazo e hora
--      em TODAS as linhas de setor do pedido. Num pedido com setores
--      dessincronizados — um com data, outro nulo, que e o estado de varios
--      pedidos hoje — salvar o boletim preenche o nulo. Se isso exigisse ADM,
--      um vendedor nao conseguiria salvar o boletim desses pedidos NEM SEM
--      TOCAR NA DATA. A trava pegaria trabalho comum em vez de alteracao de
--      promessa.
--
--   3. VALOR IGUAL. `IS DISTINCT FROM` compara antes e depois; regravar o mesmo
--      valor passa. E o caso do espelhamento em pedido ja consistente, que
--      reescreve as linhas com o que elas ja tem.
--
--   4. service_role, postgres e supabase_admin. Rota de API server-side, job e
--      migration continuam escrevendo. A trigger e SECURITY INVOKER de proposito:
--      com SECURITY DEFINER, `current_user` viraria o dono da funcao e esta
--      checagem nunca reconheceria o papel real de quem chama.
--
--   5. APAGAR (valor -> NULL) E alteracao e EXIGE permissao. Zerar a data e
--      desfazer a promessa; nao ha por que ser mais facil que muda-la.
--
-- ============================================================================
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
-- ============================================================================
--   Nao altera nenhuma politica de RLS, nem estreita nem afrouxa. A RLS das duas
--   tabelas continua liberando UPDATE amplo — sao as OUTRAS colunas que dependem
--   disso, e a trava e por coluna, nao por linha. Trigger e RLS convivem: a RLS
--   decide se a linha pode ser tocada, a trigger decide se ESTA coluna mudou sem
--   permissao.
--   Nao emite GRANT nem REVOKE.
--   Nao toca em feriados, soma_dias_uteis, produtos, cotacao_frete, pagamentos_v2
--   nem Conta Corrente.
--   Nao conserta public.is_admin(), apesar de a ter encontrado quebrada.
--   Nao altera nenhuma coluna, constraint ou indice.
--
-- ============================================================================
-- MEDIDO NO BANCO EM 08/09/2026, ANTES DE ESCREVER
-- ============================================================================
--   public.usuarios ........ 30 linhas | 7 is_admin | 5 is_super_adm | 30 com perfil
--   public.perfis .......... 9 perfis, todos ativos
--   `pedidos.edit_data` esta em: perfil 2 (Administrador) e, por '*', no perfil 1
--   (Super Administrador). NAO esta em Vendedor (4), Designer (6) nem Expedidor (9).
--
--   Conferido por `osqr__has_permissao(uid, 'pedidos.edit_data')`:
--     userteste3 (super)      -> true
--     userteste2 (is_admin)   -> true
--     Celi Santana (perfil 2) -> true   <- e is_admin = false
--     userteste1 (vendedor)   -> false
--     Bianca Santos (designer)-> false
--     contato (pendente)      -> false
--
--   Triggers ja existentes nas duas tabelas: NENHUMA. Estas sao as primeiras.
-- ============================================================================

do $migration$
declare
  v_triggers  bigint;
  v_perm      bigint;
begin
  -- ==========================================================================
  -- ASSERCOES DE ENTRADA
  -- ==========================================================================

  if to_regclass('public.propostas_os') is null then
    raise exception 'ENTRADA: public.propostas_os nao existe';
  end if;
  if to_regclass('public.propostas_os_setores') is null then
    raise exception 'ENTRADA: public.propostas_os_setores nao existe';
  end if;

  -- 1. A funcao de permissao existe E `authenticated` pode executa-la. Sem isso
  --    a trigger falharia para todo usuario logado — que e exatamente o defeito
  --    de usar `osqr__has_permissao` aqui.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cc__assert_permissao'
  ) then
    raise exception 'ENTRADA: public.cc__assert_permissao nao existe — esta trava depende dela';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(p.proacl) a
     where n.nspname = 'public' and p.proname = 'cc__assert_permissao'
       and a.privilege_type = 'EXECUTE'
       and a.grantee::regrole::text = 'authenticated'
  ) then
    raise exception 'ENTRADA: authenticated nao pode executar cc__assert_permissao — a trava travaria todo mundo';
  end if;

  -- 2. A permissao existe em algum perfil ativo. Se nao existisse, a trava
  --    bloquearia ate os administradores.
  select count(*) into v_perm
    from public.perfis
   where ativo = true
     and (permissoes ? '*' or permissoes ? 'pedidos.edit_data');
  if v_perm = 0 then
    raise exception 'ENTRADA: nenhum perfil ativo tem pedidos.edit_data — a trava bloquearia todos';
  end if;
  raise notice 'ENTRADA: % perfil(is) ativo(s) podem editar a data', v_perm;

  -- 3. As triggers ainda nao existem.
  select count(*) into v_triggers
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public'
     and c.relname in ('propostas_os','propostas_os_setores')
     and t.tgname = 'trg_prazo_exige_adm';
  if v_triggers <> 0 then
    raise exception 'ENTRADA: trg_prazo_exige_adm JA existe em % tabela(s)', v_triggers;
  end if;

  -- ==========================================================================
  -- A FUNCAO DE TRIGGER
  -- ==========================================================================
  create function public.fn_prazo_entrega_exige_permissao()
  returns trigger
  language plpgsql
  security invoker
  set search_path = pg_catalog, public
  as $fn$
  declare
    v_campo text := null;
  begin
    -- Papel de servico passa direto. SECURITY INVOKER preserva `current_user`;
    -- com DEFINER isto viraria o dono da funcao e nunca reconheceria o chamador.
    if current_user in ('service_role', 'postgres', 'supabase_admin') then
      return new;
    end if;

    -- O que mudou. NULL -> valor nao conta: e preenchimento, nao alteracao.
    if TG_TABLE_NAME = 'propostas_os' then
      if old.data_termino is not null
         and new.data_termino is distinct from old.data_termino then
        v_campo := 'a data de entrega';
      end if;

    elsif TG_TABLE_NAME = 'propostas_os_setores' then
      if old.prazo is not null and new.prazo is distinct from old.prazo then
        v_campo := 'a data de entrega';
      elsif old.hora is not null and new.hora is distinct from old.hora then
        v_campo := 'a hora de entrega';
      end if;
    end if;

    if v_campo is null then
      return new;
    end if;

    -- A regra de permissao do projeto, nao uma copia dela.
    begin
      perform public.cc__assert_permissao(auth.uid(), 'pedidos.edit_data');
    exception when others then
      raise exception
        'Alterar % de um pedido exige perfil de administrador. Peca a um ADM para ajustar o prazo, ou solicite a permissao "pedidos.edit_data" ao seu perfil.',
        v_campo
        using errcode = '42501';
    end;

    return new;
  end;
  $fn$;

  comment on function public.fn_prazo_entrega_exige_permissao() is
    'Recusa UPDATE que ALTERE data/hora de entrega ja gravada sem a permissao pedidos.edit_data. Nao afeta INSERT, nao afeta preenchimento de valor NULO, nao afeta regravacao do mesmo valor, e nao afeta service_role/postgres. A regra de quem e ADM vem de public.cc__assert_permissao — nao ha copia dela aqui.';

  -- ==========================================================================
  -- AS DUAS TRIGGERS
  -- ==========================================================================
  -- `UPDATE OF <coluna>` restringe o disparo as instrucoes que MENCIONAM a
  -- coluna, o que evita rodar a funcao em todo update das outras colunas. A
  -- comparacao IS DISTINCT FROM dentro da funcao continua necessaria: mencionar
  -- nao e mudar, e o espelhamento menciona sempre.
  create trigger trg_prazo_exige_adm
    before update of data_termino on public.propostas_os
    for each row execute function public.fn_prazo_entrega_exige_permissao();

  create trigger trg_prazo_exige_adm
    before update of prazo, hora on public.propostas_os_setores
    for each row execute function public.fn_prazo_entrega_exige_permissao();

  -- ==========================================================================
  -- ASSERCOES DE SAIDA
  -- ==========================================================================

  -- 4. As duas triggers existem, BEFORE UPDATE, FOR EACH ROW.
  select count(*) into v_triggers
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public'
     and c.relname in ('propostas_os','propostas_os_setores')
     and t.tgname = 'trg_prazo_exige_adm';
  if v_triggers <> 2 then
    raise exception 'SAIDA: esperadas 2 triggers, ha %', v_triggers;
  end if;

  -- 5. A funcao ficou SECURITY INVOKER. DEFINER aqui quebraria a checagem de
  --    `current_user` e deixaria service_role cair na trava.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_prazo_entrega_exige_permissao'
       and p.prosecdef
  ) then
    raise exception 'SAIDA: a funcao ficou SECURITY DEFINER, deveria ser INVOKER';
  end if;

  -- 6. A RLS das duas tabelas NAO foi tocada: continua ligada e com o mesmo
  --    numero de politicas de antes — 9 em propostas_os e 4 em
  --    propostas_os_setores, 13 no total, medido em 08/09/2026.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='propostas_os' and c.relrowsecurity
  ) then
    raise exception 'SAIDA: RLS de propostas_os saiu do ar';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='propostas_os_setores' and c.relrowsecurity
  ) then
    raise exception 'SAIDA: RLS de propostas_os_setores saiu do ar';
  end if;

  select count(*) into v_perm
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relname in ('propostas_os','propostas_os_setores');
  if v_perm <> 13 then
    raise notice 'AVISO: esperadas 13 politicas nas duas tabelas (medido em 08/09/2026), ha %', v_perm;
  end if;

  raise notice 'SAIDA OK: 2 triggers criadas, funcao SECURITY INVOKER, RLS intacta com % politicas', v_perm;
end
$migration$;

-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   Derrubar as triggers devolve a data e a hora ao estado anterior: alteraveis
--   por qualquer autenticado, inclusive direto pelo PostgREST. Nenhum dado se
--   perde — a trava nunca escreveu nada, so recusou escrita alheia.
--
--   A trava de TELA (`lockDate`, em BoletimFormPage) continua de pe depois deste
--   rollback, e continua sendo apenas sugestao.
--
--   drop trigger if exists trg_prazo_exige_adm on public.propostas_os_setores;
--   drop trigger if exists trg_prazo_exige_adm on public.propostas_os;
--   drop function if exists public.fn_prazo_entrega_exige_permissao();
-- ============================================================================
