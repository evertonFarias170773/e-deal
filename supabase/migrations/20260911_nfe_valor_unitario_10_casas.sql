-- NF-e: valor unitario do item passa a 10 casas decimais
--
-- ATENCAO — ESTA MIGRATION SOZINHA NAO RESOLVE O PROBLEMA.
--   Ela e 2 das 5 mudancas necessarias. As outras tres sao de codigo e NAO
--   estao aqui:
--     3. `.toFixed(4)` em nfe.service.ts:1107 (montagem do item);
--     4. `.toFixed(4)` em NfeDetailPage.tsx:3011 (recalculo quando o operador
--        edita o valor do item na tela)  <-- DESCOBERTO EM 11/09/2026,
--        nao constava no plano de 4 pontos;
--     5. nada mais no banco: varri pg_proc e as views, e so `fn_montar_payload_nfe`
--        limitava casas.
--
--   Aplicar so esta migration deixa o banco pronto e o resultado igual ao de
--   hoje. Aplicar esta mais o item 3 corrige a nota nova, mas o item 4 faz o
--   defeito VOLTAR assim que o operador editar o valor do item — que e
--   exatamente o gesto de correcao manual que esta rodada quer eliminar.
--
-- O QUE E
--   Duas colunas e uma funcao:
--     1. `notas_fiscais_itens.valor_unitario`            (14,4) -> (16,10)
--     2. `notas_fiscais_itens.valor_unitario_tributavel` (14,4) -> (16,10)
--     3. `fn_montar_payload_nfe`: as DUAS mascaras `FM9999999990.0000`
--        passam a `FM9999999990.0000000000`.
--
--   Nao faz backfill. Nao altera nota emitida. Nao mexe em trigger.
--
-- POR QUE
--   O item da nota nasce de `produtos_proposta.valor_sub_total / qtd`, e o
--   resultado nao cabe em 4 casas. O trigger `trg_calcular_valor_bruto_nfe_item`
--   entao grava `round(quantidade * valor_unitario, 2)`, que passa a divergir do
--   subtotal de origem — e o operador corrige a mao antes de emitir.
--
--   Medido em 11/09/2026 sobre os 1.397 itens de proposta:
--
--     escala | fecham | divergem |      % | maior dif | soma difs
--     -------|--------|----------|--------|-----------|----------
--        4   |    947 |      450 | 32,21% |  R$ 5,25  | R$ 52,47
--        6   |  1.363 |       34 |  2,43% |  R$ 0,04  | R$  0,39
--        8   |  1.397 |        0 |  0,00% |  R$ 0,00  | R$  0,00
--       10   |  1.397 |        0 |  0,00% |  R$ 0,00  | R$  0,00
--
--   O erro e POR UNIDADE e cresce com a quantidade. A regra, validada contra os
--   dados (zero itens divergem abaixo do limite, em todas as escalas):
--
--     erro maximo do unitario = 0,5 x 10^-N
--     fecha enquanto           qtd x 0,5 x 10^-N < 0,005   <=>   qtd < 10^(N-2)
--
--     escala 4  -> limite      100 unidades   (1.116 itens ja passam disso)
--     escala 6  -> limite   10.000 unidades   (93 itens passam)
--     escala 8  -> limite    1 milhao         (0 itens hoje)
--     escala 10 -> limite  100 milhoes        (0 itens hoje)
--
-- POR QUE 10 E NAO 8
--   As duas zeram hoje. A diferenca e MARGEM. A maior tiragem ja feita e de
--   115.830 unidades; 8 casas aguentam ate 1 milhao — uma ordem de grandeza de
--   folga. Uma tiragem de 1,5 milhao traz o defeito de volta, silencioso, do
--   mesmo jeito que esta hoje. 10 casas e o TETO do layout da NF-e 4.00 para
--   `vUnCom` (11v0-10): nao da para pedir mais, custa dois digitos e aguenta
--   ate 100 milhoes.
--
--   DIZIMAS NAO SAO O PROBLEMA, e vale dizer porque assusta: 590 dos 1.397
--   itens (42%) tem divisao que nao termina em decimal — nao fecham nem em 12
--   casas. Nenhuma escala jamais tornara esse unitario exato, e NAO PRECISA: o
--   que importa e o erro ACUMULADO ficar abaixo de meio centavo para o
--   `round(..., 2)` do trigger devolver o subtotal. Com 10 casas, uma dizima
--   erra 0,00000000005 por unidade — em 115.830 unidades, R$ 0,0000058.
--
-- POR QUE `numeric(16,10)`
--   16 - 10 = 6 digitos inteiros, ate R$ 999.999,9999999999.
--   Maior unitario ja gravado em nota:        R$    75,00
--   Maior unitario projetado sobre TODAS as propostas: R$ 440,00 (3 digitos)
--   Folga de tres ordens de grandeza. O layout permitiria 11 inteiros
--   (`numeric(21,10)`); 6 e de sobra para a operacao e mantem a coluna enxuta.
--
-- POR QUE AS DUAS COLUNAS, E NAO SO A COMERCIAL
--   `trg_calcular_valor_bruto_nfe_item` copia o comercial para o tributavel
--   quando as unidades coincidem — e elas sempre coincidem hoje ("UN"):
--
--     new.valor_unitario_tributavel := new.valor_unitario;
--
--   Com o tributavel em (14,4), a copia TRUNCARIA na atribuicao e o payload
--   sairia com comercial e tributavel divergentes. As duas mudam juntas ou
--   nenhuma muda.
--
-- POR QUE A FUNCAO E RECRIADA POR SUBSTITUICAO DO PROPRIO FONTE
--   `fn_montar_payload_nfe` tem 17.204 caracteres. Transcrever isso a mao para
--   trocar duas mascaras e um risco desproporcional ao ganho. O passo 4 abaixo
--   le `pg_get_functiondef`, troca as duas ocorrencias e reexecuta — com
--   assercao de que sao EXATAMENTE DUAS antes e ZERO depois. O corpo nao e
--   reescrito por mim em lugar nenhum.
--
--   `CREATE OR REPLACE` PRESERVA O ACL (diferente de DROP + CREATE). O ACL de
--   antes, para conferencia:
--
--     dono: postgres
--     PUBLIC=EXECUTE, anon=EXECUTE, authenticated=EXECUTE,
--     postgres=EXECUTE, service_role=EXECUTE
--
--   Esse `anon=EXECUTE` vem do ALTER DEFAULT PRIVILEGES do schema, que concede
--   a `anon` toda funcao nova — as quatro funcoes de NF-e tem o mesmo ACL. Nao
--   mexo nisso aqui; fica registrado como ponto a revisar em separado.
--
-- AS DUAS VIEWS QUE IMPEDIAM O ALTER
--   `ALTER COLUMN ... TYPE` falha com "cannot alter type of a column used by a
--   view or rule" quando ha view dependente. Ha DUAS:
--
--     vw_nfe_itens_conferencia_valores   (le valor_unitario e valor_unitario_tributavel)
--     vw_notas_fiscais_validacao_itens   (le valor_unitario)
--
--   Elas sao derrubadas e recriadas na MESMA transacao, a partir da definicao
--   capturada do catalogo — nao de uma copia minha. Os GRANTs sao recolocados e
--   conferidos por assercao contra o ACL de antes. As duas tem hoje:
--     authenticated, postgres, service_role = ALL
--
--   NOTA SOBRE `vw_nfe_itens_conferencia_valores`: ela calcula
--   `diferenca_comercial = valor_bruto - round(quantidade * valor_unitario, 2)`
--   e marca erro acima de 1 centavo. Isso e SEMPRE ZERO, porque o trigger
--   garante a igualdade por construcao — a view nao ve o problema real, que e a
--   divergencia contra a PROPOSTA, nao contra o proprio item. Ela e recriada
--   identica; corrigir o que ela mede e outra decisao.
--
-- SOBRE O REWRITE E O LOCK
--   Mudar a ESCALA de um numeric muda a representacao armazenada, entao
--   `ALTER COLUMN TYPE` REESCREVE A TABELA. Com 71 itens isso e instantaneo.
--   O lock e ACCESS EXCLUSIVE em `notas_fiscais_itens` — trava leitura e
--   escrita enquanto durar. Por isso a migration abre com `lock_timeout = 5s`:
--   se o lock nao vier, ela falha e nao aplica nada, em vez de segurar a tabela.
--   Rode fora do expediente.
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   Nao toca em `trg_calcular_valor_bruto_nfe_item` — ele continua garantindo a
--   identidade `vProd = qCom x vUnCom` que a SEFAZ valida. Nao altera
--   `valor_bruto` (segue em 2 casas) nem `quantidade`. Nao reescreve os 71 itens
--   existentes: mudar o tipo da coluna nao altera valor, e os 71 estao
--   internamente consistentes hoje. Nao toca nas 10 notas AUTORIZADA, nem nas
--   em PROCESSANDO, CANCELADA ou DENEGADA. Nao mexe em desconto nem no bonus de
--   tabela especial, que sao assunto separado. Nao altera RLS, permissao ou
--   codigo de aplicacao.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERCOES DE ENTRADA — abortam antes de qualquer escrita
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_esc_com  int;
  v_esc_trib int;
  v_mascaras int;
  v_views    int;
  v_indices  int;
  v_maior    numeric;
  v_itens    bigint;
begin
  select numeric_scale into v_esc_com from information_schema.columns
   where table_schema='public' and table_name='notas_fiscais_itens' and column_name='valor_unitario';
  select numeric_scale into v_esc_trib from information_schema.columns
   where table_schema='public' and table_name='notas_fiscais_itens' and column_name='valor_unitario_tributavel';

  if v_esc_com is null or v_esc_trib is null then
    raise exception 'ABORTADO: coluna valor_unitario e/ou valor_unitario_tributavel nao existe.';
  end if;
  if v_esc_com <> 4 or v_esc_trib <> 4 then
    raise exception 'ABORTADO: escalas esperadas 4 e 4, encontradas % e %. Alguem ja mexeu; reveja antes.', v_esc_com, v_esc_trib;
  end if;

  -- a funcao existe e tem EXATAMENTE as duas mascaras a trocar
  if to_regprocedure('public.fn_montar_payload_nfe(text)') is null then
    raise exception 'ABORTADO: fn_montar_payload_nfe(text) nao existe com essa assinatura.';
  end if;
  select count(*) into v_mascaras
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
         lateral regexp_matches(p.prosrc, 'FM9999999990\.0000(?!0)', 'g')
   where n.nspname='public' and p.proname='fn_montar_payload_nfe';
  if v_mascaras <> 2 then
    raise exception 'ABORTADO: esperadas 2 mascaras FM9999999990.0000 em fn_montar_payload_nfe, encontradas %.', v_mascaras;
  end if;

  -- as duas views dependentes existem (serao derrubadas e recriadas)
  select count(*) into v_views from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v'
     and c.relname in ('vw_nfe_itens_conferencia_valores','vw_notas_fiscais_validacao_itens');
  if v_views <> 2 then
    raise exception 'ABORTADO: esperadas 2 views dependentes, encontradas %. O roteiro de drop/recreate nao cobre o estado atual.', v_views;
  end if;

  -- indice nas colunas impediria o ALTER sem recriacao; nao deve haver nenhum
  select count(*) into v_indices
    from pg_index i join pg_class c on c.oid=i.indrelid
    join pg_attribute a on a.attrelid=c.oid and a.attnum = any(i.indkey)
   where c.relname='notas_fiscais_itens' and a.attname in ('valor_unitario','valor_unitario_tributavel');
  if v_indices <> 0 then
    raise exception 'ABORTADO: % indice(s) sobre as colunas. Reveja o roteiro.', v_indices;
  end if;

  -- todo valor existente cabe em numeric(16,10): 6 digitos inteiros
  select coalesce(max(greatest(abs(valor_unitario), abs(coalesce(valor_unitario_tributavel,0)))), 0)
    into v_maior from notas_fiscais_itens;
  if v_maior >= 1000000 then
    raise exception 'ABORTADO: maior valor unitario e %, nao cabe em numeric(16,10) (max 999999,9999999999).', v_maior;
  end if;

  select count(*) into v_itens from notas_fiscais_itens;

  raise notice 'Assercoes de entrada OK. Escalas 4/4, 2 mascaras, 2 views, 0 indices, maior unitario %, % itens.', v_maior, v_itens;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSOS 1 a 3 — derrubar as views, alterar as colunas, recriar as views
--
-- Tudo num bloco so porque a definicao das views e capturada do catalogo ANTES
-- do drop e reaplicada depois. Em nenhum momento a definicao e reescrita a mao.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def_conf  text;
  v_def_valid text;
  v_acl_conf  text[];
  v_acl_valid text[];
  v_acl_pos   text[];
begin
  -- capturar definicao e ACL das duas views
  select pg_get_viewdef('public.vw_nfe_itens_conferencia_valores'::regclass, true) into v_def_conf;
  select pg_get_viewdef('public.vw_notas_fiscais_validacao_itens'::regclass, true) into v_def_valid;

  select coalesce((select array_agg(coalesce(r.rolname,'PUBLIC')||'='||x.privilege_type
                                    order by coalesce(r.rolname,'PUBLIC'), x.privilege_type)
                     from aclexplode(c.relacl) x left join pg_roles r on r.oid=x.grantee), '{}')
    into v_acl_conf from pg_class c where c.oid='public.vw_nfe_itens_conferencia_valores'::regclass;
  select coalesce((select array_agg(coalesce(r.rolname,'PUBLIC')||'='||x.privilege_type
                                    order by coalesce(r.rolname,'PUBLIC'), x.privilege_type)
                     from aclexplode(c.relacl) x left join pg_roles r on r.oid=x.grantee), '{}')
    into v_acl_valid from pg_class c where c.oid='public.vw_notas_fiscais_validacao_itens'::regclass;

  if v_def_conf is null or v_def_valid is null then
    raise exception 'ABORTADO: nao consegui capturar a definicao de uma das views.';
  end if;

  -- PASSO 1: derrubar
  execute 'drop view public.vw_nfe_itens_conferencia_valores';
  execute 'drop view public.vw_notas_fiscais_validacao_itens';

  -- PASSO 2: alterar as duas colunas (reescreve a tabela; 71 linhas)
  execute 'alter table public.notas_fiscais_itens
             alter column valor_unitario type numeric(16,10)';
  execute 'alter table public.notas_fiscais_itens
             alter column valor_unitario_tributavel type numeric(16,10)';

  -- PASSO 3: recriar as views com a definicao capturada
  execute 'create view public.vw_nfe_itens_conferencia_valores as ' || v_def_conf;
  execute 'create view public.vw_notas_fiscais_validacao_itens as ' || v_def_valid;

  -- devolver os GRANTs
  execute 'grant all on public.vw_nfe_itens_conferencia_valores to authenticated, service_role';
  execute 'grant all on public.vw_notas_fiscais_validacao_itens to authenticated, service_role';

  -- conferir que o ACL voltou identico ao de antes
  select coalesce((select array_agg(coalesce(r.rolname,'PUBLIC')||'='||x.privilege_type
                                    order by coalesce(r.rolname,'PUBLIC'), x.privilege_type)
                     from aclexplode(c.relacl) x left join pg_roles r on r.oid=x.grantee), '{}')
    into v_acl_pos from pg_class c where c.oid='public.vw_nfe_itens_conferencia_valores'::regclass;
  if v_acl_pos is distinct from v_acl_conf then
    raise exception 'ABORTADO: ACL de vw_nfe_itens_conferencia_valores mudou. Antes: %. Depois: %.', v_acl_conf, v_acl_pos;
  end if;

  select coalesce((select array_agg(coalesce(r.rolname,'PUBLIC')||'='||x.privilege_type
                                    order by coalesce(r.rolname,'PUBLIC'), x.privilege_type)
                     from aclexplode(c.relacl) x left join pg_roles r on r.oid=x.grantee), '{}')
    into v_acl_pos from pg_class c where c.oid='public.vw_notas_fiscais_validacao_itens'::regclass;
  if v_acl_pos is distinct from v_acl_valid then
    raise exception 'ABORTADO: ACL de vw_notas_fiscais_validacao_itens mudou. Antes: %. Depois: %.', v_acl_valid, v_acl_pos;
  end if;

  raise notice 'Colunas alteradas para numeric(16,10) e as duas views recriadas com o ACL preservado.';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 4 — as duas mascaras do payload
--
-- Le o fonte do catalogo, troca as duas ocorrencias e reexecuta.
-- `CREATE OR REPLACE` preserva dono, ACL e assinatura.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_src       text;
  v_novo      text;
  v_antes     int;
  v_dep       int;
  v_ancora    int;
  v_2casas_a  int;
  v_2casas_d  int;
  -- A ancora inteira do campo, nao a mascara solta. `FM9999999990.00` aparece
  -- 10 vezes na funcao, quase toda em valor monetario; trocar cega estragaria
  -- valor_bruto, valor_frete, valor_produtos e os totais.
  c_ancora_de constant text :=
    '''quantidade_comercial'', to_char(item.quantidade, ''FM9999999990.00'')';
  c_ancora_para constant text :=
    '''quantidade_comercial'', to_char(item.quantidade, ''FM9999999990.0000'')';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='fn_montar_payload_nfe';

  select count(*) into v_antes from regexp_matches(v_src, 'FM9999999990\.0000(?!0)', 'g');
  if v_antes <> 2 then
    raise exception 'ABORTADO: esperadas 2 mascaras de 4 casas no functiondef, encontradas %.', v_antes;
  end if;

  -- a ancora de quantidade_comercial tem de ser UNICA
  v_ancora := (length(v_src) - length(replace(v_src, c_ancora_de, ''))) / length(c_ancora_de);
  if v_ancora <> 1 then
    raise exception 'ABORTADO: ancora de quantidade_comercial esperada 1 vez, encontrada % vez(es). Nao troque cega.', v_ancora;
  end if;

  select count(*) into v_2casas_a from regexp_matches(v_src, 'FM9999999990\.00(?!0)', 'g');
  if v_2casas_a <> 10 then
    raise exception 'ABORTADO: esperadas 10 mascaras de 2 casas, encontradas %. O fonte mudou; reveja a ancora.', v_2casas_a;
  end if;

  -- 1) unitario comercial e tributavel: 4 -> 10 casas
  v_novo := replace(v_src, 'FM9999999990.0000', 'FM9999999990.0000000000');
  -- 2) quantidade_comercial: 2 -> 4 casas, SO na ancora do campo
  v_novo := replace(v_novo, c_ancora_de, c_ancora_para);

  select count(*) into v_dep from regexp_matches(v_novo, 'FM9999999990\.0000(?!0)', 'g');
  if v_dep <> 1 then
    raise exception 'ABORTADO: esperada 1 mascara de 4 casas apos a troca (a de quantidade_comercial), encontradas %.', v_dep;
  end if;

  -- as 9 mascaras monetarias restantes NAO podem ter sido tocadas
  select count(*) into v_2casas_d from regexp_matches(v_novo, 'FM9999999990\.00(?!0)', 'g');
  if v_2casas_d <> 9 then
    raise exception 'ABORTADO: esperadas 9 mascaras de 2 casas apos a troca, encontradas %. Alguma mascara monetaria foi alterada.', v_2casas_d;
  end if;

  execute v_novo;
  raise notice 'fn_montar_payload_nfe recriada: 2 mascaras de unitario para 10 casas e quantidade_comercial para 4, com 9 monetarias intactas.';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERCOES DE SAIDA
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_esc_com  int;
  v_esc_trib int;
  v_prec_com int;
  v_m4       int;
  v_m10      int;
  v_views    int;
  v_acl      text[];
  v_autoriz  bigint;
begin
  select numeric_precision, numeric_scale into v_prec_com, v_esc_com
    from information_schema.columns
   where table_schema='public' and table_name='notas_fiscais_itens' and column_name='valor_unitario';
  select numeric_scale into v_esc_trib from information_schema.columns
   where table_schema='public' and table_name='notas_fiscais_itens' and column_name='valor_unitario_tributavel';

  if v_prec_com <> 16 or v_esc_com <> 10 then
    raise exception 'FALHOU: valor_unitario deveria ser numeric(16,10), esta (%,%).', v_prec_com, v_esc_com;
  end if;
  if v_esc_trib <> 10 then
    raise exception 'FALHOU: valor_unitario_tributavel deveria ter escala 10, tem %.', v_esc_trib;
  end if;

  select count(*) into v_m4
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
         lateral regexp_matches(p.prosrc, 'FM9999999990\.0000(?!0)', 'g')
   where n.nspname='public' and p.proname='fn_montar_payload_nfe';
  if v_m4 <> 0 then
    raise exception 'FALHOU: ainda restam % mascara(s) de 4 casas na funcao.', v_m4;
  end if;

  select count(*) into v_m10
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
         lateral regexp_matches(p.prosrc, 'FM9999999990\.0000000000', 'g')
   where n.nspname='public' and p.proname='fn_montar_payload_nfe';
  if v_m10 <> 2 then
    raise exception 'FALHOU: esperadas 2 mascaras de 10 casas, encontradas %.', v_m10;
  end if;

  select count(*) into v_views from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v'
     and c.relname in ('vw_nfe_itens_conferencia_valores','vw_notas_fiscais_validacao_itens');
  if v_views <> 2 then
    raise exception 'FALHOU: as duas views nao voltaram (encontradas %).', v_views;
  end if;

  -- o ACL da funcao tem de ter sobrevivido ao CREATE OR REPLACE
  select coalesce((select array_agg(coalesce(r.rolname,'PUBLIC')||'='||x.privilege_type
                                    order by coalesce(r.rolname,'PUBLIC'))
                     from aclexplode(p.proacl) x left join pg_roles r on r.oid=x.grantee), '{}')
    into v_acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='fn_montar_payload_nfe';
  if not (v_acl @> array['authenticated=EXECUTE','service_role=EXECUTE','postgres=EXECUTE']::text[]) then
    raise exception 'FALHOU: ACL de fn_montar_payload_nfe nao preservado: %', v_acl;
  end if;

  -- nota emitida intocada: as 10 AUTORIZADA continuam la
  select count(*) into v_autoriz from notas_fiscais where status = 'AUTORIZADA';
  if v_autoriz <> 10 then
    raise exception 'FALHOU: esperadas 10 notas AUTORIZADA, encontradas %. Esta migration nao deveria mexer nisso.', v_autoriz;
  end if;

  raise notice 'Assercoes de saida OK. Colunas (16,10), 2 mascaras de 10 casas, 2 views, ACL preservado, 10 notas AUTORIZADA intactas.';
end $$;

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) os tipos
--   select column_name, data_type, numeric_precision, numeric_scale
--     from information_schema.columns
--    where table_schema='public' and table_name='notas_fiscais_itens'
--      and column_name in ('valor_unitario','valor_unitario_tributavel','valor_bruto','quantidade')
--    order by column_name;
--   -- esperado: valor_unitario e valor_unitario_tributavel em (16,10);
--   --           valor_bruto continua (14,2) e quantidade continua (14,4).
--
--   -- b) OS 71 ITENS NAO MUDARAM DE VALOR — impressao digital
--   select count(*) as itens,
--          md5(string_agg(id::text||'|'||valor_unitario::text||'|'||valor_bruto::text, ';' order by id)) as impressao
--     from notas_fiscais_itens;
--   -- ATENCAO: `valor_unitario::text` MUDA de representacao — 75.0000 vira
--   -- 75.0000000000 —, entao o md5 MUDA por forca do tipo, nao do valor. A
--   -- comparacao honesta e a (c).
--
--   -- c) nenhum valor numerico foi alterado — criterio ABSOLUTO
--   select count(*) as itens,
--          sum(valor_unitario) as soma_unitarios,
--          sum(valor_bruto) as soma_brutos,
--          count(*) filter (where valor_bruto <> round(quantidade*valor_unitario,2)) as inconsistentes
--     from notas_fiscais_itens where coalesce(ativo,true);
--   -- MEDIDO ANTES em 11/09/2026: 71 itens, 0 inconsistentes.
--   -- esperado: mesmos 71, mesmas somas, 0 inconsistentes.
--
--   -- d) as duas views respondem
--   select count(*) from vw_nfe_itens_conferencia_valores;
--   select count(*) from vw_notas_fiscais_validacao_itens;
--   -- esperado: sem erro. A primeira deve continuar com erro_valor_comercial
--   -- falso em tudo — ela compara o item consigo mesmo, nao com a proposta.
--
--   -- e) o payload sai com 10 casas. Rodar numa nota em RASCUNHO/PENDENTE.
--   select jsonb_path_query_first(
--            fn_montar_payload_nfe(ref),
--            '$.items[0].valor_unitario_comercial') as unitario_no_payload
--     from notas_fiscais where status = 'PENDENTE' limit 1;
--   -- esperado: string com ate 10 casas decimais. ANTES saia com 4.
--   -- NAO rodar em nota AUTORIZADA: so leitura, mas nao ha o que conferir la.
--
--   -- f) o efeito de verdade so aparece na PROXIMA nota criada, e SO depois
--   --    dos itens 3 e 4 do topo (o codigo). Ate la, o unitario continua
--   --    chegando com 4 casas vindo da aplicacao, e a coluna maior nao muda
--   --    nada sozinha. Conferir com uma proposta de tiragem grande:
--   select pp.id_int, pp.qtd, pp.valor_sub_total,
--          round(pp.valor_sub_total/pp.qtd, 10) as unitario_esperado_10casas,
--          round(pp.qtd * round(pp.valor_sub_total/pp.qtd, 10), 2) as bruto_esperado
--     from produtos_proposta pp
--    where pp.qtd > 10000 order by pp.qtd desc limit 3;
--   -- esperado: bruto_esperado = valor_sub_total em todos.
--
-- ROLLBACK
--   Reversivel. Nenhum valor de nota e alterado por esta migration, entao voltar
--   atras nao perde dado — so devolve o truncamento.
--
--   ATENCAO: se ja houver item gravado com mais de 4 casas quando voce
--   reverter, o ALTER de volta ARREDONDA esses valores para 4 casas, em
--   silencio. Confira antes:
--     select count(*) from notas_fiscais_itens where scale(valor_unitario) > 4;
--   Se vier maior que zero, reverter MUDA valor de item. Nesse caso decida
--   nota a nota, e nunca reverta com nota em PENDENTE aguardando envio.
--
--   -- 1) derrubar as views (elas travam o ALTER, como travaram na ida)
--   -- drop view public.vw_nfe_itens_conferencia_valores;
--   -- drop view public.vw_notas_fiscais_validacao_itens;
--
--   -- 2) voltar as colunas
--   -- set local lock_timeout = '5s';
--   -- alter table public.notas_fiscais_itens alter column valor_unitario type numeric(14,4);
--   -- alter table public.notas_fiscais_itens alter column valor_unitario_tributavel type numeric(14,4);
--
--   -- 3) recriar as views (capture a definicao do catalogo ANTES do drop,
--   --    como o passo 3 da ida faz) e devolver os grants:
--   -- grant all on public.vw_nfe_itens_conferencia_valores to authenticated, service_role;
--   -- grant all on public.vw_notas_fiscais_validacao_itens to authenticated, service_role;
--
--   -- 4) voltar as mascaras do payload, pelo mesmo caminho da ida:
--   --    ler pg_get_functiondef, replace de 'FM9999999990.0000000000' por
--   --    'FM9999999990.0000', e executar.
--
--   NAO faz parte do rollback mexer em `trg_calcular_valor_bruto_nfe_item`,
--   em `valor_bruto` ou em nota emitida. Nada disso foi tocado na ida.
