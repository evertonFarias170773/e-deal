-- `fn_defaults_rascunho_nfe` deixa de sobrescrever a natureza da operacao
--
-- POR QUE
--   Hoje esta trigger (BEFORE INSERT em notas_fiscais) grava natureza_operacao
--   e drop_natureza_op INCONDICIONALMENTE, a partir da UF do endereco principal
--   de new.id_cliente. O que a aplicacao manda e descartado: `naturezaDefault`,
--   calculado em nfe.service.ts:706, nunca chega ao banco -- nenhuma das 25
--   notas tem o texto que aquele codigo produz. E codigo morto sem saber que e.
--
--   Enquanto a natureza foi sempre "venda", isso nao incomodou. Passa a
--   incomodar agora, que a tela ganha um select: escolha do usuario que a
--   trigger apaga nao e escolha.
--
--   Desenho (c), decidido em 28/08/2026: a APLICACAO e a autoridade; a trigger
--   vira REDE DE SEGURANCA. Preenche so quando ninguem mandou nada, para que
--   nota nascida por outro caminho (n8n, SQL manual) nao fique sem natureza --
--   campo que a SEFAZ exige e que `fn_alertas_nfe` cobra.
--
--   E o mesmo padrao que `fn_sync_natureza_operacao_nfe` ja usa nesta tabela:
--   agir apenas sobre campo vazio. Aquela trigger nao e tocada aqui.
--
-- O QUE MUDA
--   Uma condicao. O bloco de natureza passa a rodar somente quando
--   natureza_operacao E drop_natureza_op chegarem os dois vazios.
--
--   Os demais defaults (tipo_documento, finalidade_emissao, presenca_comprador,
--   e a regra de CPF => consumidor final / nao contribuinte) NAO mudam: seguem
--   incondicionais como hoje.
--
-- O TEXTO SAI DO CATALOGO, NAO DE LITERAL
--   Os textos deixam de ser strings escritas dentro da funcao e passam a vir de
--   `nfe_naturezas_operacao`, filtrando modelo_fiscal = 'NFE' e ativo = true.
--   Havia TRES grafias para a mesma ideia -- o codigo, esta trigger e o catalogo
--   -- e duas delas viviam fora da tabela feita para isso.
--
--   ATENCAO, PONTO EM ABERTO: qual coluna do catalogo alimenta
--   `natureza_operacao`. Esta migration usa `descricao` sem o prefixo de CFOP,
--   que e exatamente o que `fn_sync_natureza_operacao_nfe` ja calcula, e que
--   produz texto valido nas 8 naturezas de NF-e.
--
--   NAO usa `observacao`, apesar de ser o texto que esta gravado nas 25 notas de
--   hoje, porque em 2 das 8 linhas ele e INSTRUCAO AO OPERADOR, nao natureza:
--     5949 -> "OUTRA SAIDA DENTRO DO ESTADO - USAR SOMENTE QUANDO NAO HOUVER
--              CFOP MAIS ESPECIFICO"
--     6949 -> idem, fora do estado
--   Mandar isso no campo natOp da NF-e seria declarar a instrucao interna para a
--   SEFAZ.
--
--   CONSEQUENCIA ACEITA: rascunho novo passa a nascer com "Venda de producao do
--   estabelecimento" onde antes nascia com "VENDA DENTRO DO ESTADO - PRODUCAO
--   PROPRIA". As 25 notas existentes NAO sao tocadas -- sem backfill -- entao
--   por um tempo convivem os dois textos. Se a preferencia for manter a grafia
--   antiga, trocar `v_natureza` para usar `observacao`: e uma linha, marcada
--   abaixo.
--
-- IMPACTO EM NOTA EXISTENTE: NENHUM
--   BEFORE INSERT nao roda em linha ja gravada. Esta migration nao faz UPDATE,
--   nao faz backfill e nao altera as tres notas divergentes de 22/08, que sao
--   residuo pre-Etapa C.
--
-- ACL
--   `CREATE OR REPLACE FUNCTION` com a MESMA assinatura `()` preserva o ACL e o
--   vinculo com a trigger: nao ha DROP, entao nao ha grant a reemitir. Estado
--   atual, que deve permanecer identico depois:
--     {=X/postgres, postgres=X/postgres, anon=X/postgres,
--      authenticated=X/postgres, service_role=X/postgres}
--   `anon` tem grant NOMINAL -- um REVOKE FROM PUBLIC nao o alcancaria. Esta
--   migration nao emite GRANT nem REVOKE; a verificacao no rodape existe para
--   provar que nada mudou.
--
-- NAO FAZ
--   Nao toca `fn_sync_natureza_operacao_nfe`, o catalogo, `notas_servico`, o
--   CFOP dos itens, RLS, policies nem permissoes. Nao cria coluna:
--   `drop_natureza_op` ja existe.
--
-- ROLLBACK: ver rodape.

begin;

create or replace function public.fn_defaults_rascunho_nfe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_documento text;
  v_uf_destinatario text;
  v_cfop text;
  v_descricao text;
  v_natureza text;
begin
  select
    regexp_replace(coalesce(c.documento, ''), '\D', '', 'g'),
    upper(trim(coalesce(e.uf, '')))
  into
    v_documento,
    v_uf_destinatario
  from public.clientes c
  left join public.enderecos e
    on e.id_cliente = c.id_cliente
   and lower(trim(e.tipo_endereco)) = 'principal'
  where c.id_cliente = new.id_cliente::integer
  limit 1;

  -- Padrões fixos da NF-e — inalterados.
  new.tipo_documento := coalesce(nullif(new.tipo_documento, ''), '1');
  new.finalidade_emissao := coalesce(nullif(new.finalidade_emissao, ''), '1');
  new.presenca_comprador := coalesce(nullif(new.presenca_comprador, ''), '9');

  -- CPF sempre consumidor final / não contribuinte — inalterado.
  if length(coalesce(v_documento, '')) = 11 then
    new.consumidor_final := '1';
    new.tipo_contribuinte := '9';
  end if;

  -- NATUREZA: rede de segurança, não autoridade.
  --
  -- Só age quando os DOIS campos chegam vazios, ou seja, quando ninguém
  -- decidiu. Escolha da aplicação — e, por ela, do usuário — passa intacta.
  if coalesce(trim(new.natureza_operacao), '') = ''
     and coalesce(trim(new.drop_natureza_op), '') = ''
     and coalesce(v_uf_destinatario, '') <> '' then

    v_cfop := case when v_uf_destinatario = 'RS' then '5101' else '6101' end;

    select n.descricao
      into v_descricao
      from public.nfe_naturezas_operacao n
     where n.cfop = v_cfop
       and n.modelo_fiscal = 'NFE'
       and n.ativo is true
     limit 1;

    if v_descricao is not null then
      -- Mesma derivação de `fn_sync_natureza_operacao_nfe`: tira o "NNNN - ".
      -- << TROCAR AQUI se a preferência for manter a grafia das 25 notas
      --    antigas: `select n.observacao into v_natureza ...` no lugar. >>
      v_natureza := trim(regexp_replace(v_descricao, '^\s*\d{4}\s*-\s*', ''));

      new.drop_natureza_op := v_descricao;
      new.natureza_operacao := v_natureza;
    end if;
  end if;

  return new;
end;
$function$;

comment on function public.fn_defaults_rascunho_nfe() is
  'Defaults do rascunho de NF-e no BEFORE INSERT. A natureza da operacao e REDE DE SEGURANCA: so e preenchida quando natureza_operacao e drop_natureza_op chegam ambos vazios, para nao sobrescrever a escolha da aplicacao. Textos vem de nfe_naturezas_operacao, nunca de literal.';

commit;

-- ============================================================================
-- VERIFICACOES (rodar depois de aplicar; nenhuma escreve)
--
--   -- 1. ACL identico ao de antes
--   select p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='fn_defaults_rascunho_nfe';
--   -- esperado: {=X/postgres,postgres=X/postgres,anon=X/postgres,
--   --            authenticated=X/postgres,service_role=X/postgres}
--
--   -- 2. a trigger continua ligada, BEFORE INSERT
--   select tgname, pg_get_triggerdef(oid)
--     from pg_trigger
--    where tgname = 'trg_defaults_rascunho_nfe';
--
--   -- 3. SECURITY DEFINER e search_path preservados
--   select prosecdef, proconfig
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='fn_defaults_rascunho_nfe';
--   -- esperado: true | {search_path=public}
--
--   -- 4. nenhuma nota existente mudou
--   select coalesce(natureza_operacao,'(nulo)'), coalesce(drop_natureza_op,'(nulo)'), count(*)
--     from public.notas_fiscais group by 1,2 order by 3 desc;
--   -- esperado, igual a antes:
--   --   VENDA DENTRO DO ESTADO - PRODUCAO PROPRIA | 5101 - Venda de producao do estabelecimento | 20
--   --   VENDA FORA DO ESTADO - PRODUCAO PROPRIA   | 6101 - Venda de producao do estabelecimento |  5
--
--   -- 5. a outra trigger de natureza segue intacta
--   select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='fn_sync_natureza_operacao_nfe';
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar em transacao)
--
-- Restaura o comportamento incondicional. Depois do rollback a trigger volta a
-- sobrescrever a escolha do usuario -- reverter o CODIGO do select antes, senao
-- a tela oferece uma escolha que o banco descarta.
--
-- begin;
--
-- create or replace function public.fn_defaults_rascunho_nfe()
-- returns trigger language plpgsql security definer set search_path to 'public'
-- as $$
-- declare
--   v_documento text;
--   v_uf_destinatario text;
-- begin
--   select
--     regexp_replace(coalesce(c.documento, ''), '\D', '', 'g'),
--     upper(trim(coalesce(e.uf, '')))
--   into v_documento, v_uf_destinatario
--   from public.clientes c
--   left join public.enderecos e
--     on e.id_cliente = c.id_cliente
--    and lower(trim(e.tipo_endereco)) = 'principal'
--   where c.id_cliente = new.id_cliente::integer
--   limit 1;
--
--   new.tipo_documento := coalesce(nullif(new.tipo_documento, ''), '1');
--   new.finalidade_emissao := coalesce(nullif(new.finalidade_emissao, ''), '1');
--   new.presenca_comprador := coalesce(nullif(new.presenca_comprador, ''), '9');
--
--   if length(coalesce(v_documento, '')) = 11 then
--     new.consumidor_final := '1';
--     new.tipo_contribuinte := '9';
--   end if;
--
--   if v_uf_destinatario = 'RS' then
--     new.natureza_operacao := 'VENDA DENTRO DO ESTADO - PRODUÇÃO PRÓPRIA';
--     new.drop_natureza_op := '5101 - Venda de produção do estabelecimento';
--   elsif coalesce(v_uf_destinatario, '') <> '' then
--     new.natureza_operacao := 'VENDA FORA DO ESTADO - PRODUÇÃO PRÓPRIA';
--     new.drop_natureza_op := '6101 - Venda de produção do estabelecimento';
--   end if;
--
--   return new;
-- end;
-- $$;
--
-- commit;
-- ============================================================================
