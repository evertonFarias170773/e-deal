-- =====================================================================
-- Renomear variacao global para de reescrever proposta historica
-- =====================================================================
--
-- APLICADA em 08/09/2026, registrada como 20260909002042.
--
-- O ESCOPO MUDOU ANTES DE APLICAR, e o motivo vale ficar aqui:
-- o pedido original era derrubar o trigger e a funcao. Ao ler o corpo, a
-- funcao fazia DOIS update — o defeito e um cache legitimo. Derrubar tudo
-- mataria o sync de `produto_variacoes.nome`, que o app le com preferencia
-- sobre `variacoes.nome`. O dono optou por preservar a metade legitima.
--
-- O QUE
-- -----
-- `fn_cascade_update_variacoes_nome` fazia DOIS update. Esta migration remove
-- o PRIMEIRO e preserva o SEGUNDO:
--
--   REMOVIDO   update produtos_proposta_variacao set nome_variacao = new.nome
--   PRESERVADO update produto_variacoes            set nome          = new.nome
--
-- O trigger `tg_cascade_update_variacoes_nome` em `variacoes` CONTINUA
-- existindo. So o corpo da funcao muda, por CREATE OR REPLACE.
--
-- Nao toca em dado. Nao toca em RLS, grant nem auditoria. Nao mexe em
-- `tg_cascade_update_tipos_variacoes_peso` nem em `trg_recalc_produto_variacao`.
--
-- POR QUE
-- -------
-- `produtos_proposta_variacao.nome_variacao` guarda o nome da OPCAO escolhida
-- na venda, nao o nome do grupo. Verificado nas 87 linhas existentes em
-- 08/09/2026: bate 100% com `tipos_variacoes.variacao` e nunca com
-- `variacoes.nome`.
--
-- Com a cascata, renomear o grupo "3 ACABAMENTO" substituiria "Mosquete Metal",
-- "Jacare Metalico" e as demais por "3 ACABAMENTO" em TODAS as linhas
-- historicas daquele grupo. Perde-se qual opcao o cliente escolheu, e
-- `gerar_descricao_variacoes` — que concatena justamente `nome_variacao` —
-- passa a devolver o nome do grupo repetido.
--
-- O defeito NUNCA disparou: ninguem renomeou um grupo desde que o trigger
-- existe, e os 87 registros estao integros. Esta migration e preventiva. A tela
-- de editar variacao global (`/produtos/variacoes/[id]`) expoe esse campo e
-- qualquer usuario logado pode grava-lo hoje.
--
-- POR QUE A SEGUNDA METADE FICA
-- -----------------------------
-- `produto_variacoes.nome` e copia denormalizada do nome do grupo, e o app
-- PREFERE ela ao nome real:
--
--   nome: String(row.nome || rawVar.nome || "")
--   src/features/produtos/services/produto-variacoes.service.ts:568
--
-- Derrubar o trigger inteiro faria a tela do produto exibir o nome ANTIGO do
-- grupo para sempre depois de um rename. Hoje 15 dos 16 vinculos estao em
-- sincronia por causa desse update. O unico fora e o vinculo 78 (grupo 21 "a",
-- inativo), que ja estava dessincronizado antes do trigger existir e NAO e
-- corrigido aqui.
--
-- Esse update e legitimo: cache denormalizado do MESMO campo que acabou de
-- mudar, na tabela de vinculo. O outro nao era: snapshot de outra coisa.
--
-- O QUE ESTA MIGRATION NAO RESOLVE, e fica registrado
-- ---------------------------------------------------
-- 1. `tg_cascade_update_tipos_variacoes` (em `tipos_variacoes`, AFTER UPDATE OF
--    variacao) TAMBEM escreve `nome_variacao`, com `new.variacao` — o nome da
--    opcao. E coerente com a coluna, diferente do defeito corrigido aqui, mas
--    ainda assim reescreve snapshot historico. Fora do escopo desta rodada.
--
-- 2. `tg_cascade_update_tipos_variacoes_peso` reescreve `peso_uni` historico e
--    dispara recalculo de `produtos_proposta.peso_extra`. Preservado por
--    decisao explicita do dono; e outra discussao.
--
-- 3. `copiar_proposta_v2` le e grava `nome_variacao`, mas so por INSERT ao
--    duplicar proposta. Nao e cascata e nao muda nada existente.
--
-- 4. As politicas de RLS de `variacoes` e `tipos_variacoes` exigem apenas
--    `auth.uid() IS NOT NULL` — qualquer usuario logado escreve no catalogo
--    global. As permissoes `variacoes.*` vivem so no front. Outro assunto.
--
-- RISCO
-- -----
-- Baixo. A mudanca so DEIXA DE ESCREVER; nao passa a escrever nada novo.
-- Nenhum backfill: os 87 registros estao integros e ficam byte a byte como
-- estao.
-- =====================================================================


-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA
-- ------------------------------------------------------------------
do $entrada$
declare
  v_ddl      text;
  v_md5      text;
  v_linhas   int;
  v_triggers int;
begin
  select pg_get_functiondef(p.oid) into v_ddl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_cascade_update_variacoes_nome';

  if v_ddl is null then
    raise exception 'ABORTADO: fn_cascade_update_variacoes_nome nao existe.';
  end if;

  -- As DUAS metades precisam estar presentes. Se a primeira ja sumiu, alguem
  -- aplicou algo antes desta migration e o diagnostico precisa ser refeito.
  if v_ddl !~ 'update produtos_proposta_variacao' then
    raise exception 'ABORTADO: a cascata para produtos_proposta_variacao JA nao esta na funcao. Estado inesperado.';
  end if;
  if v_ddl !~ 'update produto_variacoes' then
    raise exception 'ABORTADO: a metade legitima (produto_variacoes) nao esta na funcao. Estado inesperado.';
  end if;

  -- Um unico trigger usa esta funcao. Se houver outro, ele herdaria a mudanca
  -- sem ninguem ter avaliado, e a migration precisa parar.
  select count(*) into v_triggers
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_cascade_update_variacoes_nome';

  if v_triggers <> 1 then
    raise exception 'ABORTADO: esperava 1 trigger usando a funcao, encontrei %.', v_triggers;
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.variacoes'::regclass
       and t.tgname = 'tg_cascade_update_variacoes_nome'
       and not t.tgisinternal
  ) then
    raise exception 'ABORTADO: tg_cascade_update_variacoes_nome nao esta em variacoes.';
  end if;

  -- Baseline do dado que NAO pode mudar. O md5 esperado foi medido em
  -- 08/09/2026, antes desta migration, e esta gravado aqui de proposito: a
  -- assercao de saida compara contra a MESMA constante.
  select count(*),
         md5(string_agg(id::text || '|' || coalesce(nome_variacao,'<null>'), E'\n' order by id))
    into v_linhas, v_md5
    from public.produtos_proposta_variacao;

  if v_linhas <> 87 or v_md5 <> '76fb74e2b7e964d39877d0c87e5fce81' then
    raise exception 'ABORTADO: baseline de produtos_proposta_variacao mudou desde o diagnostico. linhas=% (esperado 87), md5=% (esperado 76fb74e2b7e964d39877d0c87e5fce81). Refaca a medicao antes de aplicar.',
      v_linhas, v_md5;
  end if;

  raise notice 'Entrada OK: funcao com as 2 metades, 1 unico trigger, 87 linhas com md5 76fb74e2b7e964d39877d0c87e5fce81.';
end
$entrada$;


-- ------------------------------------------------------------------
-- 2. A FUNCAO, SEM A CASCATA PARA A PROPOSTA
--    Corpo identico ao instalado, menos o primeiro update.
--    O trigger tg_cascade_update_variacoes_nome NAO e recriado nem derrubado:
--    CREATE OR REPLACE troca o corpo por baixo dele.
-- ------------------------------------------------------------------
create or replace function public.fn_cascade_update_variacoes_nome()
returns trigger
language plpgsql
as $function$
begin
  -- NAO cascateia para produtos_proposta_variacao.
  --
  -- Ate 08/09/2026 esta funcao fazia, aqui:
  --
  --   update produtos_proposta_variacao
  --      set nome_variacao = new.nome
  --    where id_variacao = new.id_variacao;
  --
  -- Era defeito. `nome_variacao` guarda o nome da OPCAO escolhida na venda
  -- (snapshot), nao o nome do grupo. Renomear o grupo apagava qual opcao o
  -- cliente escolheu em toda proposta historica daquele grupo. Nunca chegou a
  -- disparar; foi removido antes.
  --
  -- Nome de opcao gravado na venda e imutavel por rename de grupo. Se algum dia
  -- precisar mudar, muda por decisao explicita, nao por efeito colateral.

  -- Cache denormalizado do nome do grupo na tabela de vinculo. Este SIM deve
  -- acompanhar o rename: o app le `produto_variacoes.nome` com preferencia
  -- sobre `variacoes.nome` (produto-variacoes.service.ts:568), entao sem isto a
  -- tela do produto exibiria o nome antigo indefinidamente.
  update produto_variacoes
  set nome = new.nome
  where id_variacao = new.id_variacao;

  return new;
end;
$function$;


-- ------------------------------------------------------------------
-- 3. ASSERCOES DE SAIDA
-- ------------------------------------------------------------------
do $saida$
declare
  v_ddl     text;
  v_corpo   text;
  v_md5     text;
  v_linhas  int;
  v_id      int;
  v_falhou  text := null;
  v_n       int;
begin
  select pg_get_functiondef(p.oid) into v_ddl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_cascade_update_variacoes_nome';

  -- O corpo NOVO cita `produtos_proposta_variacao` de proposito, no comentario
  -- que registra a remocao. Entao procurar o nome da tabela no DDL inteiro
  -- daria falso positivo, e ancorar com `^` nao resolve: em `~` o `^` casa so
  -- com o inicio da STRING, nao de cada linha — a assercao passaria sempre, do
  -- jeito errado. Por isso o teste roda sobre o DDL SEM comentarios.
  v_corpo := regexp_replace(v_ddl, '--[^\n]*', '', 'g');

  -- 3.1 A cascata defeituosa saiu.
  if v_corpo ~ 'update\s+produtos_proposta_variacao' then
    raise exception 'ABORTADO: o update em produtos_proposta_variacao continua na funcao.';
  end if;

  -- 3.2 A metade legitima ficou.
  if v_corpo !~ 'update\s+produto_variacoes' then
    raise exception 'ABORTADO: o sync de produto_variacoes.nome foi perdido.';
  end if;

  -- 3.3 O trigger continua vivo, no mesmo evento e na mesma tabela.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.variacoes'::regclass
       and t.tgname = 'tg_cascade_update_variacoes_nome'
       and not t.tgisinternal
       and pg_get_triggerdef(t.oid) like '%AFTER UPDATE OF nome ON public.variacoes%'
  ) then
    raise exception 'ABORTADO: tg_cascade_update_variacoes_nome sumiu ou mudou de evento. Era para ser PRESERVADO.';
  end if;

  -- 3.4 Nenhuma linha de produtos_proposta_variacao mudou.
  select count(*),
         md5(string_agg(id::text || '|' || coalesce(nome_variacao,'<null>'), E'\n' order by id))
    into v_linhas, v_md5
    from public.produtos_proposta_variacao;

  if v_linhas <> 87 or v_md5 <> '76fb74e2b7e964d39877d0c87e5fce81' then
    raise exception 'ABORTADO: produtos_proposta_variacao MUDOU. linhas=%, md5=%.', v_linhas, v_md5;
  end if;

  -- 3.5 PROVA POR COMPORTAMENTO, em subtransacao abortada.
  --
  --     Renomeia de verdade um grupo que tenha vinculo E uso em proposta, e
  --     confere as duas coisas de uma vez: nome_variacao intacto, e
  --     produto_variacoes.nome acompanhando. O RAISE no fim desfaz tudo.
  select v.id_variacao into v_id
    from public.variacoes v
   where exists (select 1 from public.produto_variacoes pv
                  where pv.id_variacao = v.id_variacao)
     and exists (select 1 from public.produtos_proposta_variacao p
                  where p.id_variacao = v.id_variacao)
   order by v.id_variacao
   limit 1;

  if v_id is null then
    raise notice 'ATENCAO: nenhum grupo com vinculo E uso em proposta; a prova por comportamento foi PULADA.';
  else
    begin
      update public.variacoes
         set nome = 'ZZ TESTE ROLLBACK'
       where id_variacao = v_id;

      -- a) o snapshot da proposta NAO pode ter mudado
      select md5(string_agg(id::text || '|' || coalesce(nome_variacao,'<null>'), E'\n' order by id))
        into v_md5 from public.produtos_proposta_variacao;
      if v_md5 <> '76fb74e2b7e964d39877d0c87e5fce81' then
        v_falhou := format('renomear o grupo %s ainda altera nome_variacao', v_id);
      end if;

      -- b) o cache do vinculo TEM que ter acompanhado
      select count(*) into v_n
        from public.produto_variacoes
       where id_variacao = v_id and nome = 'ZZ TESTE ROLLBACK';
      if v_falhou is null and v_n = 0 then
        v_falhou := format('produto_variacoes.nome nao acompanhou o rename do grupo %s', v_id);
      end if;

      -- desfaz TUDO o que este bloco escreveu
      raise exception using errcode = 'ZZ001', message = 'rollback proposital do teste';
    exception
      when sqlstate 'ZZ001' then null;   -- esperado: a subtransacao foi desfeita
    end;

    if v_falhou is not null then
      raise exception 'ABORTADO: %.', v_falhou;
    end if;

    raise notice 'Comportamento OK: rename do grupo % nao tocou nome_variacao e sincronizou produto_variacoes.nome (teste desfeito por rollback).', v_id;
  end if;

  -- 3.6 O dado segue intacto DEPOIS do teste.
  select count(*),
         md5(string_agg(id::text || '|' || coalesce(nome_variacao,'<null>'), E'\n' order by id))
    into v_linhas, v_md5
    from public.produtos_proposta_variacao;

  if v_linhas <> 87 or v_md5 <> '76fb74e2b7e964d39877d0c87e5fce81' then
    raise exception 'ABORTADO: o rollback do teste nao desfez tudo. linhas=%, md5=%.', v_linhas, v_md5;
  end if;

  raise notice 'Saida OK: cascata removida, trigger preservado, 87 linhas com md5 76fb74e2b7e964d39877d0c87e5fce81 intacto.';
end
$saida$;


-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Nao ha rollback de dado: esta migration nao escreve em linha alguma. O bloco
-- de teste da assercao de saida e desfeito por rollback dentro da propria
-- transacao.
--
-- Para restaurar o comportamento anterior — ou seja, voltar a reescrever o
-- snapshot historico, que era o defeito:
--
--   create or replace function public.fn_cascade_update_variacoes_nome()
--   returns trigger
--   language plpgsql
--   as $function$
--   begin
--     -- Atualiza produtos_proposta_variacao
--     update produtos_proposta_variacao
--     set nome_variacao = new.nome
--     where id_variacao = new.id_variacao;
--
--     -- Atualiza produto_variacoes
--     update produto_variacoes
--     set nome = new.nome
--     where id_variacao = new.id_variacao;
--
--     return new;
--   end;
--   $function$;
--
-- O trigger tg_cascade_update_variacoes_nome nao precisa de reversao: ele nao
-- foi tocado.
-- =====================================================================
