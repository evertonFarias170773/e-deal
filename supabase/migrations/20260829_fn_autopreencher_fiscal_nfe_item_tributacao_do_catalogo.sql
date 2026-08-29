-- `fn_autopreencher_fiscal_nfe_item`: a tributacao de fallback passa a sair do
-- catalogo de naturezas, e nao mais de `produtos`
--
-- POR QUE
--   Esta trigger preenche campo fiscal VAZIO do item a partir do cadastro do
--   produto. Enquanto toda nota era venda com CSOSN 102 isso nunca incomodou:
--   `produtos` tem 102 em 65 dos 68 cadastros, o mesmo valor que o codigo grava
--   como literal. A rede de seguranca sempre concordou com quem ela protegia.
--
--   A migration 20260829_nfe_naturezas_operacao_tributacao_e_operacoes_novas
--   quebrou esse empate. O catalogo agora diz que 5202 e 6202 -- devolucao de
--   compra, SAIDA -- tem tributacao NULA de proposito: devolucao espelha a nota
--   de origem, e quem decide e o usuario, nota a nota. O desenho da etapa
--   seguinte e o item nascer VAZIO nessas naturezas, e `pendencias.ts` barrar a
--   emissao ate alguem preencher.
--
--   So que vazio e exatamente o que esta trigger preenche. Um item de devolucao
--   nasceria com CSOSN 102 vindo de `produtos` -- valor de VENDA TRIBUTADA numa
--   devolucao --, o campo deixaria de estar vazio, `pendencias.ts` nao barraria
--   nada, e `fn_montar_payload_nfe` copiaria o valor direto para a SEFAZ sem
--   conferir. A nota sairia ACEITA e errada.
--
--   E nao ha como contornar pela aplicacao: limpar o campo e salvar nomeia a
--   coluna no UPDATE, a trigger dispara de novo e repreenche. Ela so se cala
--   quando `id_produto` e nulo, e os itens tem produto.
--
-- O QUE MUDA
--   Uma unica coisa: DE ONDE vem o valor de fallback das tres colunas de
--   tributacao.
--
--     natureza da nota CASA com o catalogo  -> fallback = CATALOGO,
--                                              inclusive quando o catalogo e NULO
--     natureza NAO casa (ou nota sem natureza)-> fallback = `produtos`, como hoje
--
--   "Casa" significa `notas_fiscais.drop_natureza_op` igual a
--   `nfe_naturezas_operacao.descricao`, com modelo_fiscal = 'NFE'. E a MESMA
--   chave que a aplicacao ja usa para derivar o CFOP e para marcar a opcao no
--   select -- nao inventa um segundo criterio.
--
--   A regra de "so preenche o que esta vazio" NAO muda. Valor que o usuario
--   informou continua intocado, venha de onde vier.
--
-- O QUE NAO MUDA
--   `ncm`, `unidade_comercial`, `unidade_tributavel` e `icms_origem` seguem
--   vindo de `produtos`, identicos.
--
--   O BLOCO DE CFOP SEGUE LITERALMENTE IGUAL, inclusive `cfop_interno` e
--   `cfop_interestadual` de `produtos`. Nao foi tocado -- e ha uma razao tecnica
--   para isso alem do escopo:
--
--     ATENCAO A `found`. Naquele bloco, `found` NAO se refere a busca da nota:
--     refere-se ao ultimo SELECT executado, que e o do endereco. Se a nota nao
--     for encontrada, o bloco interno nem roda e `found` fica com o resultado da
--     busca da nota (falso). Qualquer SELECT novo inserido ANTES do bloco de
--     CFOP mudaria silenciosamente o valor de `found` e, com ele, o CFOP.
--
--     Por isso a consulta ao catalogo foi colocada DEPOIS do bloco de CFOP, e as
--     tres atribuicoes de tributacao foram para junto dela. A ordem entre elas e
--     irrelevante -- nenhuma depende da outra --, e assim o bloco preservado nao
--     precisou de uma virgula de alteracao.
--
--   `id_produto` nulo continua saindo cedo, sem tocar em nada. Produto nao
--   encontrado idem.
--
-- CASAR PODE DEVOLVER MAIS DE UMA LINHA?
--   Hoje nao: `descricao` e distinta nas 22 linhas da tabela, NFE e NFSE
--   somadas. Mas a UNIQUE da tabela e (cfop, descricao), NAO (descricao) -- nada
--   impede um cadastro futuro repetir o texto com outro CFOP. Como isto roda
--   dentro de trigger, onde um erro derruba a gravacao do item, a consulta usa
--   `order by n.id limit 1`: deterministica por construcao, e nunca levanta
--   excecao. Se um dia houver duas, vence a mais antiga -- e a verificacao 5 no
--   rodape existe para denunciar o caso.
--
-- IMPACTO EM ITEM EXISTENTE: NENHUM
--   Nao ha backfill: BEFORE INSERT OR UPDATE nao roda sozinha em linha parada.
--
--   E editar item de nota antiga tambem nao muda nada. Conferido nos 28 itens
--   vivos: todos os tres campos preenchidos, nenhum vazio, as 25 notas casando
--   com o catalogo, e ZERO itens cujo valor divergiria do que o catalogo diria.
--   Como a trigger so age em campo VAZIO, ela nem chega a consultar a origem do
--   fallback nesses itens. E mesmo que alguem limpasse um campo, o catalogo
--   devolveria 102/99/99 -- exatamente o que `produtos` devolvia.
--
--   Os 38 itens orfaos (id_nota_fiscal sem linha em notas_fiscais) tambem nao
--   sao tocados: sem nota, nao ha natureza, e o caminho e o de hoje.
--
-- ACL
--   `CREATE OR REPLACE FUNCTION` com a MESMA assinatura `()` preserva o ACL e o
--   vinculo com a trigger: nao ha DROP, entao nao ha grant a reemitir. Estado
--   atual, que deve permanecer identico depois:
--     {=X/postgres, postgres=X/postgres, anon=X/postgres,
--      authenticated=X/postgres, service_role=X/postgres}
--   Ou seja: EXECUTE para PUBLIC (`=X`) E grant NOMINAL para anon, authenticated,
--   service_role e postgres. Um REVOKE FROM PUBLIC nao alcancaria os nominais --
--   por isso a verificacao 1 confere o ACL com array_agg de grantee, e nao so o
--   texto bruto. Esta migration nao emite GRANT nem REVOKE.
--
-- NAO FAZ
--   Nao toca `fn_montar_payload_nfe`, `fn_criar_rascunho_nfe`,
--   `fn_defaults_rascunho_nfe` nem `fn_sync_natureza_operacao_nfe`. Nao altera o
--   catalogo. Nao faz UPDATE em notas_fiscais_itens. Nao cria coluna. Nao mexe em
--   RLS, policy nem permissao. Nao altera codigo da aplicacao, e nao remove o
--   filtro provisorio de VENDA -- enquanto ele estiver de pe, 5202 e 6202 sequer
--   aparecem na tela, e esta trigger fica esperando.
--
-- ROLLBACK: ver rodape.

begin;

create or replace function public.fn_autopreencher_fiscal_nfe_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_produto record;
  v_nf record;
  v_empresa record;
  v_uf_destino text;
  -- Tributacao vinda do catalogo, quando a natureza da nota casa com ele.
  v_cat_icms text;
  v_cat_pis text;
  v_cat_cofins text;
  v_cat_encontrada boolean := false;
begin
  -- Se não tiver produto vinculado, é item totalmente avulso.
  -- Nesse caso o usuário precisa preencher manualmente.
  if new.id_produto is null then
    return new;
  end if;

  -- Busca dados do produto base
  select
    p.id_produto,
    p.ncm,
    p.cfop_interno,
    p.cfop_interestadual,
    p.unidade_comercial,
    p.unidade_tributavel,
    p.icms_origem,
    p.icms_situacao_tributaria,
    p.pis_situacao_tributaria,
    p.cofins_situacao_tributaria
  into v_produto
  from public.produtos p
  where p.id_produto = new.id_produto::smallint
  limit 1;

  if not found then
    return new;
  end if;

  -- Busca NF-e para tentar definir CFOP se estiver vazio
  select *
  into v_nf
  from public.notas_fiscais
  where ref = new.ref
  limit 1;

  if found then
    select *
    into v_empresa
    from public.empresas
    where id = v_nf.id_empresa
    limit 1;

    select e.uf
    into v_uf_destino
    from public.enderecos e
    where e.id_cliente = v_nf.id_cliente
      and lower(trim(e.tipo_endereco)) = 'principal'
    limit 1;
  end if;

  -- Preenche apenas campos vazios.
  -- Não sobrescreve o que o usuário já editou manualmente.

  new.ncm :=
    coalesce(nullif(trim(new.ncm), ''), v_produto.ncm);

  new.unidade_comercial :=
    coalesce(nullif(trim(new.unidade_comercial), ''), v_produto.unidade_comercial, 'UN');

  new.unidade_tributavel :=
    coalesce(nullif(trim(new.unidade_tributavel), ''), v_produto.unidade_tributavel, 'UN');

  new.icms_origem :=
    coalesce(nullif(trim(new.icms_origem), ''), v_produto.icms_origem);

  -- CFOP: usa como fallback se estiver vazio.
  -- Se UF emitente = UF destinatário, usa cfop_interno.
  -- Caso contrário, usa cfop_interestadual.
  --
  -- INTOCADO. `found` aqui é o resultado da busca do ENDEREÇO (ou da nota,
  -- quando ela não foi encontrada e o bloco acima nem rodou). Nenhum SELECT
  -- pode ser inserido antes deste ponto sem mudar o CFOP por acidente -- é por
  -- isso que a consulta ao catálogo, abaixo, vem DEPOIS.
  if nullif(trim(coalesce(new.cfop, '')), '') is null then
    if found and v_empresa.uf is not null and v_uf_destino is not null then
      new.cfop :=
        case
          when upper(trim(v_empresa.uf)) = upper(trim(v_uf_destino))
            then v_produto.cfop_interno
          else v_produto.cfop_interestadual
        end;
    else
      new.cfop := v_produto.cfop_interno;
    end if;
  end if;

  -- TRIBUTAÇÃO: o catálogo manda, quando a natureza da nota casa com ele.
  --
  -- Mesma chave que a aplicação usa para derivar o CFOP e para marcar a opção
  -- no select: `drop_natureza_op` contra `descricao`. `limit 1` com `order by`
  -- porque a UNIQUE da tabela é (cfop, descricao) e não (descricao) -- em
  -- trigger, resultado ambíguo não pode virar exceção e derrubar a gravação.
  if coalesce(trim(v_nf.drop_natureza_op), '') <> '' then
    select
      n.icms_situacao_tributaria,
      n.pis_situacao_tributaria,
      n.cofins_situacao_tributaria
    into v_cat_icms, v_cat_pis, v_cat_cofins
    from public.nfe_naturezas_operacao n
    where n.modelo_fiscal = 'NFE'
      and n.descricao = v_nf.drop_natureza_op
    order by n.id
    limit 1;

    v_cat_encontrada := found;
  end if;

  if v_cat_encontrada then
    -- O catálogo decide -- INCLUSIVE quando decide que é nulo. É o caso de 5202
    -- e 6202: devolução espelha a nota de origem, e nenhum cadastro sabe qual
    -- é. Campo vazio aqui não é falha de preenchimento, é a resposta certa, e
    -- `pendencias.ts` barra a emissão até o usuário informar.
    new.icms_situacao_tributaria :=
      coalesce(nullif(trim(new.icms_situacao_tributaria), ''), v_cat_icms);
    new.pis_situacao_tributaria :=
      coalesce(nullif(trim(new.pis_situacao_tributaria), ''), v_cat_pis);
    new.cofins_situacao_tributaria :=
      coalesce(nullif(trim(new.cofins_situacao_tributaria), ''), v_cat_cofins);
  else
    -- Natureza fora do catálogo, ou nota sem natureza: comportamento de sempre.
    -- Vale para nota nascida por fora do app -- n8n, SQL manual, a RPC legada
    -- `fn_criar_rascunho_nfe` -- que continua protegida pelo cadastro.
    new.icms_situacao_tributaria :=
      coalesce(nullif(trim(new.icms_situacao_tributaria), ''), v_produto.icms_situacao_tributaria);
    new.pis_situacao_tributaria :=
      coalesce(nullif(trim(new.pis_situacao_tributaria), ''), v_produto.pis_situacao_tributaria);
    new.cofins_situacao_tributaria :=
      coalesce(nullif(trim(new.cofins_situacao_tributaria), ''), v_produto.cofins_situacao_tributaria);
  end if;

  -- Ajusta origem se for item manual com produto vinculado
  if new.id_produtos_proposta is null
     and nullif(trim(coalesce(new.origem_item, '')), '') is null then
    new.origem_item := 'AVULSO';
  end if;

  return new;
end;
$function$;

comment on function public.fn_autopreencher_fiscal_nfe_item() is
  'Preenche campo fiscal VAZIO do item da NF-e. A tributacao (CSOSN, PIS, COFINS) sai do CATALOGO quando notas_fiscais.drop_natureza_op casa com nfe_naturezas_operacao.descricao -- inclusive quando o catalogo tem nulo, que e o caso da devolucao de saida e significa que quem decide e o usuario. Sem casar, o fallback continua sendo o cadastro do produto. NCM, unidades, icms_origem e CFOP nao mudaram: seguem vindo de produtos.';

commit;

-- ============================================================================
-- VERIFICACOES (rodar depois de aplicar; nenhuma escreve)
--
--   -- 1. ACL IDENTICO -- com grantee explodido, nao so o texto bruto
--   select p.proacl::text as bruto,
--          (select array_agg(pg_get_userbyid(x.grantee) || ':' || x.privilege_type
--                            order by pg_get_userbyid(x.grantee))
--             from aclexplode(p.proacl) x) as detalhado
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'fn_autopreencher_fiscal_nfe_item';
--   -- esperado, bruto: {=X/postgres,postgres=X/postgres,anon=X/postgres,
--   --                   authenticated=X/postgres,service_role=X/postgres}
--   -- esperado, detalhado: anon, authenticated, postgres, service_role e o
--   --                      grantee 0 (PUBLIC), todos com EXECUTE.
--
--   -- 2. SECURITY DEFINER e search_path preservados
--   select prosecdef, proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'fn_autopreencher_fiscal_nfe_item';
--   -- esperado: true | {search_path=public}
--
--   -- 3. A trigger continua ligada, nas MESMAS colunas
--   select tgname, pg_get_triggerdef(oid)
--     from pg_trigger where tgname = 'trg_autopreencher_fiscal_nfe_item';
--   -- esperado: BEFORE INSERT OR UPDATE OF id_produto, ncm, cfop,
--   -- unidade_comercial, unidade_tributavel, icms_origem,
--   -- icms_situacao_tributaria, pis_situacao_tributaria,
--   -- cofins_situacao_tributaria ON public.notas_fiscais_itens
--
--   -- 4. NENHUM item mudou -- nao ha backfill, isto so confirma
--   select count(*) as itens,
--          count(*) filter (where icms_situacao_tributaria   = '102') as csosn_102,
--          count(*) filter (where pis_situacao_tributaria    = '99')  as pis_99,
--          count(*) filter (where cofins_situacao_tributaria = '99')  as cofins_99,
--          count(*) filter (where icms_origem = '0')                  as origem_0
--     from public.notas_fiscais_itens;
--   -- esperado: 66 | 66 | 66 | 66 | 66
--
--   -- 5. `descricao` continua distinta -- se voltar linha, a busca da trigger
--   --    ficou ambigua e o `limit 1` passou a escolher por antiguidade
--   select descricao, count(*) from public.nfe_naturezas_operacao
--    group by 1 having count(*) > 1;
--   -- esperado: ZERO linhas.
--
--   -- 6. Catalogo intacto
--   select count(*) filter (where modelo_fiscal='NFE')  as nfe,
--          count(*) filter (where modelo_fiscal='NFSE') as nfse,
--          count(*) filter (where modelo_fiscal='NFE'
--                             and icms_situacao_tributaria is null) as nfe_sem_csosn
--     from public.nfe_naturezas_operacao;
--   -- esperado: 14 | 8 | 4
--
--   -- 7. Nota e item nos mesmos numeros
--   select (select count(*) from public.notas_fiscais)       as notas,
--          (select count(*) from public.notas_fiscais_itens) as itens;
--   -- esperado: 25 | 66
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar em transacao)
--
-- Restaura o fallback por `produtos` para as tres colunas de tributacao. Depois
-- do rollback, item de devolucao volta a nascer com o CSOSN do cadastro -- ou
-- seja, 102 em 65 dos 68 produtos -- e o bloqueio de emissao da devolucao para
-- de funcionar. Se as naturezas de devolucao ja estiverem liberadas na tela,
-- reverter o CODIGO antes, ou desativar 5202 e 6202 no catalogo.
--
-- begin;
--
-- create or replace function public.fn_autopreencher_fiscal_nfe_item()
-- returns trigger language plpgsql security definer set search_path to 'public'
-- as $$
-- declare
--   v_produto record;
--   v_nf record;
--   v_empresa record;
--   v_uf_destino text;
-- begin
--   if new.id_produto is null then
--     return new;
--   end if;
--
--   select
--     p.id_produto, p.ncm, p.cfop_interno, p.cfop_interestadual,
--     p.unidade_comercial, p.unidade_tributavel, p.icms_origem,
--     p.icms_situacao_tributaria, p.pis_situacao_tributaria,
--     p.cofins_situacao_tributaria
--   into v_produto
--   from public.produtos p
--   where p.id_produto = new.id_produto::smallint
--   limit 1;
--
--   if not found then
--     return new;
--   end if;
--
--   select * into v_nf from public.notas_fiscais where ref = new.ref limit 1;
--
--   if found then
--     select * into v_empresa from public.empresas where id = v_nf.id_empresa limit 1;
--     select e.uf into v_uf_destino from public.enderecos e
--      where e.id_cliente = v_nf.id_cliente
--        and lower(trim(e.tipo_endereco)) = 'principal' limit 1;
--   end if;
--
--   new.ncm := coalesce(nullif(trim(new.ncm), ''), v_produto.ncm);
--   new.unidade_comercial := coalesce(nullif(trim(new.unidade_comercial), ''), v_produto.unidade_comercial, 'UN');
--   new.unidade_tributavel := coalesce(nullif(trim(new.unidade_tributavel), ''), v_produto.unidade_tributavel, 'UN');
--   new.icms_origem := coalesce(nullif(trim(new.icms_origem), ''), v_produto.icms_origem);
--   new.icms_situacao_tributaria := coalesce(nullif(trim(new.icms_situacao_tributaria), ''), v_produto.icms_situacao_tributaria);
--   new.pis_situacao_tributaria := coalesce(nullif(trim(new.pis_situacao_tributaria), ''), v_produto.pis_situacao_tributaria);
--   new.cofins_situacao_tributaria := coalesce(nullif(trim(new.cofins_situacao_tributaria), ''), v_produto.cofins_situacao_tributaria);
--
--   if nullif(trim(coalesce(new.cfop, '')), '') is null then
--     if found and v_empresa.uf is not null and v_uf_destino is not null then
--       new.cfop := case
--         when upper(trim(v_empresa.uf)) = upper(trim(v_uf_destino))
--           then v_produto.cfop_interno
--         else v_produto.cfop_interestadual
--       end;
--     else
--       new.cfop := v_produto.cfop_interno;
--     end if;
--   end if;
--
--   if new.id_produtos_proposta is null
--      and nullif(trim(coalesce(new.origem_item, '')), '') is null then
--     new.origem_item := 'AVULSO';
--   end if;
--
--   return new;
-- end;
-- $$;
--
-- commit;
-- ============================================================================
