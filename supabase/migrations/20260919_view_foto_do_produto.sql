-- ============================================================================
-- Foto do produto: uma fonte unica para quem consome de fora
-- ============================================================================
--
-- O QUE CRIA
--   public.vw_produto_foto_principal — UMA linha por produto, com a foto que
--     vale. E o que o consumidor externo pergunta quase sempre: "qual a foto
--     do produto 405?".
--   public.vw_produto_fotos — TODAS as fotos do produto, ja limpas e na mesma
--     ordem, para quem precisa da galeria. A posicao 1 e exatamente a linha que
--     a view acima devolve.
--
-- POR QUE
--   Hoje quem quer a foto precisa conhecer `public."fotosProdutos"` e conviver
--   com tres incomodos que nao sao problema dele:
--     1. a coluna guarda URL ABSOLUTA, e 5 das 23 linhas sao do FlutterFlow
--        (app antigo, Google Cloud Storage) em vez do Storage do Supabase. As
--        duas funcionam, entao as DUAS entram: a view nao classifica origem e
--        nao remonta URL nenhuma — devolve o texto gravado;
--     2. ha 1 linha com `imagensURL` em branco (produto 401). Ela e descartada,
--        como o proprio ERP ja faz na leitura;
--     3. nao existe coluna dizendo qual foto e a principal.
--
-- O CRITERIO DA "PRINCIPAL", e por que este
--   `created_at` DESC, desempatando por `id` DESC: vale a foto cadastrada por
--   ULTIMO. As duas colunas juntas sao uma ordem total (created_at e NOT NULL,
--   id e a PK), entao a escolha e deterministica — a mesma consulta devolve
--   sempre a mesma linha.
--
--   Medido em 19/09/2026: o ERP nao tem criterio nenhum hoje. Ele exibe a
--   primeira linha de uma consulta ordenada so por `idProduto`, e o resultado
--   varia — dos 6 produtos com mais de uma foto, 4 casam com "a mais recente"
--   (101, 104, 402, 9000) e 2 nao (401 e 405). Esta view nao muda o ERP: ela
--   apenas para de depender do acaso.
--
--   "A mais recente" e a regra util na pratica: a tela de produtos ACRESCENTA
--   fotos e nunca apaga (a exclusao esta bloqueada), entao a ultima enviada e a
--   versao mais atual do produto.
--
-- O QUE NAO MUDA
--   `public."fotosProdutos"` fica intocada: sem coluna nova, sem backfill, sem
--   DELETE. O ERP continua lendo a tabela direto, como sempre leu. Nenhum
--   objeto do Storage e tocado — inclusive os 8 orfaos da pasta `produtos/`,
--   que seguem onde estao.
--
-- RLS
--   Nada muda. `fotosProdutos` tem RLS ligada com a policy `geral`
--   (ALL, public, USING true). As views nascem com `security_invoker = true`,
--   entao a leitura passa pela MESMA policy da tabela, em nome de quem
--   consulta. Sem `security_invoker` a view rodaria como dona (postgres) e
--   furaria a RLS no dia em que ela deixasse de ser permissiva.
--
-- ACL — ESCOLHA EXPLICITA
--   O schema `public` concede tudo a `anon` por DEFAULT PRIVILEGES, e
--   `REVOKE FROM PUBLIC` nao alcanca isso. Por isso o revoke aqui e NOMINAL,
--   role a role, antes do grant.
--
--   Fica: SELECT para `authenticated` e `service_role`. `anon` NAO recebe.
--   Motivo: a view e uma LISTA do catalogo com foto — as URLs ja sao publicas
--   uma a uma, mas enumerar o catalogo inteiro sem sessao e superficie nova, e
--   essa e decisao de negocio, nao de migration. Se o consumidor externo for
--   anonimo (site publico), o grant esta pronto no rodape: uma linha.
--
-- ROLLBACK: no rodape.
-- ============================================================================

create or replace view public.vw_produto_fotos
with (security_invoker = true) as
  select
    f."idProduto"::integer            as id_produto,
    f.id                              as foto_id,
    btrim(f."imagensURL")             as url,
    f.created_at                      as criada_em,
    f."nomeProduto"                   as nome_produto,
    row_number() over (
      partition by f."idProduto"
      order by f.created_at desc, f.id desc
    )                                 as posicao
  from public."fotosProdutos" f
  where f."idProduto" is not null
    and nullif(btrim(f."imagensURL"), '') is not null;

comment on view public.vw_produto_fotos is
  'Galeria do produto: todas as fotos validas de public.fotosProdutos, sem a linha em branco, '
  'com a URL como esta gravada (Supabase ou FlutterFlow). posicao 1 = a foto de '
  'vw_produto_foto_principal. Ordem: created_at desc, id desc. Criada em 19/09/2026.';

create or replace view public.vw_produto_foto_principal
with (security_invoker = true) as
  select g.id_produto, g.foto_id, g.url, g.criada_em, g.nome_produto
  from public.vw_produto_fotos g
  where g.posicao = 1;

comment on view public.vw_produto_foto_principal is
  'Uma linha por produto: a foto que vale, sempre a cadastrada por ultimo '
  '(created_at desc, id desc). Fonte unica para consumidor externo; nao remonta URL. '
  'Criada em 19/09/2026.';

-- ACL: revoke NOMINAL (o default privilege do schema alcanca anon), depois grant.
revoke all on public.vw_produto_fotos from public, anon, authenticated, service_role;
revoke all on public.vw_produto_foto_principal from public, anon, authenticated, service_role;

grant select on public.vw_produto_fotos to authenticated, service_role;
grant select on public.vw_produto_foto_principal to authenticated, service_role;

-- ============================================================================
-- VERIFICACOES — falham a transacao inteira se algo sair do combinado
-- ============================================================================
do $migracao$
declare
  v_linhas_tabela      bigint;
  v_hash_tabela        text;
  v_produtos_com_foto  bigint;
  v_produtos_na_view   bigint;
  v_linhas_galeria     bigint;
  v_acl_principal      text;
  v_acl_galeria        text;
  v_invoker            boolean;
  v_dup                bigint;
  v_branco             bigint;
  v_legado             bigint;
begin
  -- 1. A TABELA NAO FOI TOCADA: contagem e hash de todo o conteudo.
  select count(*),
         md5(string_agg(md5(concat_ws('|', id, "idProduto", "nomeProduto", "imagensURL", created_at)), ',' order by id))
    into v_linhas_tabela, v_hash_tabela
    from public."fotosProdutos";
  if v_linhas_tabela <> 23 then
    raise exception 'assercao 1 falhou: a tabela tem % linhas (esperado 23, como antes da migration)', v_linhas_tabela;
  end if;
  raise notice 'tabela intocada: % linhas, hash %', v_linhas_tabela, v_hash_tabela;

  -- 2. UMA linha por produto, e nenhum produto perdido.
  select count(distinct "idProduto") into v_produtos_com_foto
    from public."fotosProdutos"
    where "idProduto" is not null and nullif(btrim("imagensURL"), '') is not null;
  select count(*) into v_produtos_na_view from public.vw_produto_foto_principal;
  if v_produtos_na_view <> v_produtos_com_foto then
    raise exception 'assercao 2 falhou: a view cobre % produtos e a tabela tem % com foto valida',
      v_produtos_na_view, v_produtos_com_foto;
  end if;

  select count(*) into v_dup from (
    select id_produto from public.vw_produto_foto_principal group by id_produto having count(*) > 1
  ) x;
  if v_dup > 0 then
    raise exception 'assercao 2 falhou: % produto(s) com mais de uma linha na view principal', v_dup;
  end if;

  -- 3. A linha em branco ficou de fora, e o legado do FlutterFlow entrou.
  select count(*) into v_branco from public.vw_produto_fotos where nullif(btrim(url), '') is null;
  if v_branco > 0 then
    raise exception 'assercao 3 falhou: % linha(s) em branco vazaram para a view', v_branco;
  end if;
  select count(*) into v_legado from public.vw_produto_fotos where url ilike '%flutterflow%';
  if v_legado < 1 then
    raise exception 'assercao 3 falhou: nenhuma URL de legado na galeria (esperado 5)';
  end if;

  select count(*) into v_linhas_galeria from public.vw_produto_fotos;
  raise notice 'views: % produtos na principal, % fotos na galeria (% de legado)',
    v_produtos_na_view, v_linhas_galeria, v_legado;

  -- 4. ACL exatamente o escolhido: authenticated e service_role com SELECT, anon fora.
  select coalesce(array_to_string(c.relacl, ' | '), '') into v_acl_principal
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vw_produto_foto_principal';
  select coalesce(array_to_string(c.relacl, ' | '), '') into v_acl_galeria
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vw_produto_fotos';

  if v_acl_principal like '%anon=%' or v_acl_galeria like '%anon=%' then
    raise exception 'assercao 4 falhou: anon ficou no ACL (% / %)', v_acl_principal, v_acl_galeria;
  end if;
  if v_acl_principal not like '%authenticated=r/%' or v_acl_principal not like '%service_role=r/%' then
    raise exception 'assercao 4 falhou: ACL da view principal inesperado: %', v_acl_principal;
  end if;
  raise notice 'ACL principal: % | galeria: %', v_acl_principal, v_acl_galeria;

  -- 5. security_invoker ligado: a RLS da tabela continua valendo.
  select (select option_value::boolean from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker')
    into v_invoker
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vw_produto_foto_principal';
  if v_invoker is distinct from true then
    raise exception 'assercao 5 falhou: vw_produto_foto_principal sem security_invoker';
  end if;

  select (select option_value::boolean from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker')
    into v_invoker
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vw_produto_fotos';
  if v_invoker is distinct from true then
    raise exception 'assercao 5 falhou: vw_produto_fotos sem security_invoker';
  end if;
end
$migracao$;

-- ============================================================================
-- COMO CONSULTAR
--   select url from public.vw_produto_foto_principal where id_produto = 405;
--   select url, posicao from public.vw_produto_fotos where id_produto = 405 order by posicao;
--
-- SE O CONSUMIDOR EXTERNO FOR ANONIMO (decisao do dono, nao desta migration):
--   grant select on public.vw_produto_foto_principal to anon;
--   grant select on public.vw_produto_fotos to anon;
--
-- ROLLBACK
--   drop view if exists public.vw_produto_foto_principal;
--   drop view if exists public.vw_produto_fotos;
--   -- nada mais a desfazer: a migration nao escreve dado nenhum.
-- ============================================================================
