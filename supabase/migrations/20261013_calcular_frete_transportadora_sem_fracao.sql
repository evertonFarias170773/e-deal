-- =====================================================================================
-- FRETE DAS TRANSPORTADORAS (Sao Miguel, Unesul, Motoboy): SEM FRACAO DO ADICIONAL
--
-- APLICADA em 13/10/2026 (autorizacao nominal do Everton), como calcular_frete_transportadora_sem_fracao.
--   md5 do corpo novo: 1868853882be67aaf19eee005a7de8c3. As guardas de ACL ordenam o array por valor.
--
-- O QUE E
--   CREATE OR REPLACE da funcao public.calcular_frete_transportadora(p_cidade, p_uf, p_peso),
--   o UNICO lugar onde a formula vive (o app so chama a funcao: frete.service.ts,
--   solicitarCotacaoTransportadoras; nenhum fluxo do n8n, view, trigger ou outra funcao a usa).
--
-- POR QUE
--   A formula atual e  1kg_X + extra_X * peso_em_kg,  com o peso FRACIONADO e contando o
--   primeiro quilo duas vezes. Pedido 23419 (Herval d'Oeste/SC, 237,5 g, 1kg_SM = 75, extra_SM = 3):
--   75 + 3 * 0,2375 = 75,71. O correto e 75,00.
--
-- A REGRA NOVA (por transportadora, cada uma pela sua coluna X = SM, UN, MB)
--   1kg_X nulo ou <= 0 ........... cidade nao atendida: devolve 0 (o app so oferece resultado > 0)
--   peso ate 1000 g .............. 1kg_X, sem adicional
--   peso acima de 1000 g ......... 1kg_X + extra_X * ceil((peso_g - 1000) / 1000)
--                                  (1001 a 2000 g = base + 1 extra; 2001 a 3000 g = base + 2 extra)
--   extra_X nulo ................. conta como 0
--
-- UNIDADE DE p_peso: QUILOS. O app manda input.peso (gramas) / 1000 (frete.service.ts:
--   `const pesoKg = input.peso / 1000`, payload `p_peso: pesoKg`). Por isso a funcao converte
--   para gramas com round(p_peso * 1000, 3): o arredondamento a 1 miligrama so existe para o
--   ruido de ponto flutuante nao empurrar 2000.0000000001 g para a faixa seguinte.
--
-- PESO ZERO OU NULO (comportamento ATUAL, mantido)
--   * p_peso = 0 ......... devolve 1kg_X (a formula antiga somava extra * 0). Igual ao ate 1000 g.
--   * p_peso nulo ........ cidade encontrada: devolve NULL nas tres colunas (a conta antiga
--                          extra * NULL era nula). O app trata como "sem opcao" (row.sm > 0 e falso).
--   * cidade nao encontrada: continua devolvendo 0, 0, 0 (vem antes de olhar o peso).
--
-- MANTIDO IGUAL (conferido no banco vivo em 13/10/2026)
--   assinatura (p_cidade text, p_uf text, p_peso numeric); retorno TABLE(sm numeric, un numeric,
--   mb numeric); plpgsql; VOLATILE; SECURITY INVOKER (prosecdef = false); sem search_path proprio
--   (proconfig nulo); dono postgres; ACL {postgres=X, authenticated=X, service_role=X}, SEM anon e
--   SEM PUBLIC. CREATE OR REPLACE conserva o ACL; a guarda do fim confere de novo.
--
-- O QUE NAO FAZ
--   Nao toca nos Correios, nao toca em cotacao_frete nem em nenhuma cotacao ja gravada, sem
--   backfill, sem GRANT/REVOKE, sem alterar a tabela transportadoras.
--
-- EFEITO CONHECIDO
--   Precos acima de 1 kg CAEM em geral (ex.: 2000 g: 81,00 -> 78,00), nao so os fracionados.
--   Unesul: 1kg_UN e zero em todas as 920 linhas, entao segue devolvendo 0 (e o app a ignora
--   desde 19/08/2026). Motoboy: so 11 cidades tem 1kg_MB > 0.
--   Cidades com 1kg_SM = 0 (47 linhas) deixam de devolver um valor pelo extra: passam a 0.
--
-- GUARDA
--   A migration ABORTA se o corpo vivo nao for o esperado (md5 do prosrc) ou se o ACL ja estiver
--   diferente. Depois do REPLACE, confere de novo o ACL e roda a VERIFICACAO POR CONDICAO numa
--   linha de teste que e desfeita (sub-transacao) — nada fica gravado em transportadoras.
--
-- ROLLBACK (corpo antigo, equivalente; o original usa quebras de linha CRLF, md5 4c624582...)
--   create or replace function public.calcular_frete_transportadora(p_cidade text, p_uf text, p_peso numeric)
--   returns table(sm numeric, un numeric, mb numeric)
--   language plpgsql
--   as $f$
--   declare
--     v record;
--   begin
--     select * into v from transportadoras
--      where upper(cidade) = upper(p_cidade) and upper(uf) = upper(p_uf) limit 1;
--     if not found then
--       return query select 0::numeric, 0::numeric, 0::numeric;
--       return;
--     end if;
--     return query
--     select
--       ((coalesce(v."extra_SM",0) * p_peso) + coalesce(v."1kg_SM",0))::numeric as sm,
--       ((coalesce(v."extra_UN",0) * p_peso) + coalesce(v."1kg_UN",0))::numeric as un,
--       ((coalesce(v."extra_MB",0) * p_peso) + coalesce(v."1kg_MB",0))::numeric as mb;
--   end;
--   $f$;
--   (o ACL nao muda no rollback tambem)
-- =====================================================================================

-- 1. GUARDA: corpo e ACL vivos sao os que a migration conhece
do $guarda$
declare
  v_md5   text;
  v_acl   text[];
begin
  select md5(p.prosrc),
         (select array_agg(s.g order by s.g)
            from (select case when a.grantee = 0 then 'PUBLIC' else (select rolname from pg_roles where oid = a.grantee) end as g
                    from aclexplode(p.proacl) a) s)
    into v_md5, v_acl
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'calcular_frete_transportadora'
     and pg_get_function_arguments(p.oid) = 'p_cidade text, p_uf text, p_peso numeric';
  if v_md5 is null then
    raise exception 'GUARDA: calcular_frete_transportadora(text, text, numeric) nao existe';
  end if;
  if v_md5 <> '4c624582ca362b0300188c15971bcf51' then
    raise exception 'GUARDA: o corpo vivo mudou (md5 %). Releia a funcao antes de aplicar.', v_md5;
  end if;
  if v_acl is distinct from array['authenticated', 'postgres', 'service_role']::text[] then
    raise exception 'GUARDA: o ACL vivo mudou (%).', v_acl;
  end if;
  if has_function_privilege('anon', 'public.calcular_frete_transportadora(text, text, numeric)', 'execute') then
    raise exception 'GUARDA: anon executa a funcao';
  end if;
end;
$guarda$;

-- 2. A FUNCAO
create or replace function public.calcular_frete_transportadora(p_cidade text, p_uf text, p_peso numeric)
returns table(sm numeric, un numeric, mb numeric)
language plpgsql
as $function$
declare
  v         record;
  v_gramas  numeric;
  v_kg_extra integer;
begin
  -- busca a linha correta
  select *
  into v
  from transportadoras
  where upper(cidade) = upper(p_cidade)
    and upper(uf) = upper(p_uf)
  limit 1;

  -- se nao encontrar, retorna zero (antes de olhar o peso, como sempre foi)
  if not found then
    return query
    select 0::numeric, 0::numeric, 0::numeric;
    return;
  end if;

  -- peso nulo: comportamento atual (a conta com NULL dava NULL nas tres colunas)
  if p_peso is null then
    return query
    select null::numeric, null::numeric, null::numeric;
    return;
  end if;

  -- p_peso vem em QUILOS. Gramas arredondadas a 1 mg: so tira o ruido de ponto flutuante.
  v_gramas := round(p_peso * 1000, 3);
  -- quilos cheios ACIMA do primeiro, arredondando para cima por faixa; ate 1000 g, zero
  v_kg_extra := greatest(0, ceil((v_gramas - 1000) / 1000))::integer;

  -- 1kg_X nulo ou <= 0: cidade nao atendida por essa transportadora (0, e o app nao a oferece)
  return query
  select
    case when coalesce(v."1kg_SM", 0) <= 0 then 0::numeric
         else v."1kg_SM"::numeric + coalesce(v."extra_SM", 0)::numeric * v_kg_extra end as sm,
    case when coalesce(v."1kg_UN", 0) <= 0 then 0::numeric
         else v."1kg_UN"::numeric + coalesce(v."extra_UN", 0)::numeric * v_kg_extra end as un,
    case when coalesce(v."1kg_MB", 0) <= 0 then 0::numeric
         else v."1kg_MB"::numeric + coalesce(v."extra_MB", 0)::numeric * v_kg_extra end as mb;
end;
$function$;

-- 3. VERIFICACAO POR CONDICAO (linha de teste desfeita: o bloco interno termina em excecao
--    de proposito, e a sub-transacao descarta o INSERT). Qualquer caso errado aborta a migration.
do $verifica$
declare
  r record;
begin
  begin
    insert into public.transportadoras (uf, cidade, "1kg_SM", "extra_SM", "1kg_UN", "extra_UN", "1kg_MB", "extra_MB")
    values ('ZZ', 'CIDADE TESTE FRETE', 75, 3, 0, 0, 50, 2),
           ('ZZ', 'CIDADE SM ZERADA',   0,  3, 0, 0, 0,  0);

    -- 237,5 g (0,2375 kg): so o valor de 1 kg
    select * into r from public.calcular_frete_transportadora('Cidade Teste Frete', 'zz', 0.2375);
    if r.sm <> 75 or r.mb <> 50 or r.un <> 0 then raise exception 'VERIFICA 237,5 g: sm %, mb %, un %', r.sm, r.mb, r.un; end if;
    -- 1000 g
    select * into r from public.calcular_frete_transportadora('CIDADE TESTE FRETE', 'ZZ', 1);
    if r.sm <> 75 or r.mb <> 50 then raise exception 'VERIFICA 1000 g: sm %, mb %', r.sm, r.mb; end if;
    -- 1001 g
    select * into r from public.calcular_frete_transportadora('CIDADE TESTE FRETE', 'ZZ', 1.001);
    if r.sm <> 78 or r.mb <> 52 then raise exception 'VERIFICA 1001 g: sm %, mb %', r.sm, r.mb; end if;
    -- 2000 g
    select * into r from public.calcular_frete_transportadora('CIDADE TESTE FRETE', 'ZZ', 2);
    if r.sm <> 78 or r.mb <> 52 then raise exception 'VERIFICA 2000 g: sm %, mb %', r.sm, r.mb; end if;
    -- 2001 g
    select * into r from public.calcular_frete_transportadora('CIDADE TESTE FRETE', 'ZZ', 2.001);
    if r.sm <> 81 or r.mb <> 54 then raise exception 'VERIFICA 2001 g: sm %, mb %', r.sm, r.mb; end if;
    -- ruido de ponto flutuante nao muda a faixa
    select * into r from public.calcular_frete_transportadora('CIDADE TESTE FRETE', 'ZZ', 2.0000000001);
    if r.sm <> 78 then raise exception 'VERIFICA ruido: sm %', r.sm; end if;
    -- 1kg_SM = 0: nao atendida, mesmo com extra e peso grande
    select * into r from public.calcular_frete_transportadora('CIDADE SM ZERADA', 'ZZ', 0.2375);
    if r.sm <> 0 then raise exception 'VERIFICA 1kg_SM zerado (237,5 g): sm %', r.sm; end if;
    select * into r from public.calcular_frete_transportadora('CIDADE SM ZERADA', 'ZZ', 5);
    if r.sm <> 0 then raise exception 'VERIFICA 1kg_SM zerado (5000 g): sm %', r.sm; end if;
    -- peso zero: 1kg_X (comportamento atual); peso nulo: NULL (comportamento atual)
    select * into r from public.calcular_frete_transportadora('CIDADE TESTE FRETE', 'ZZ', 0);
    if r.sm <> 75 then raise exception 'VERIFICA peso zero: sm %', r.sm; end if;
    select * into r from public.calcular_frete_transportadora('CIDADE TESTE FRETE', 'ZZ', null);
    if r.sm is not null or r.mb is not null then raise exception 'VERIFICA peso nulo: sm %, mb %', r.sm, r.mb; end if;
    -- cidade inexistente: 0, 0, 0
    select * into r from public.calcular_frete_transportadora('NAO EXISTE', 'ZZ', 3);
    if r.sm <> 0 or r.un <> 0 or r.mb <> 0 then raise exception 'VERIFICA cidade inexistente'; end if;

    raise exception 'VERIFICA_OK';
  exception when others then
    if sqlerrm <> 'VERIFICA_OK' then
      raise;
    end if;
  end;

  -- nada do teste ficou gravado
  if exists (select 1 from public.transportadoras where uf = 'ZZ') then
    raise exception 'VERIFICA: a linha de teste nao foi desfeita';
  end if;
end;
$verifica$;

-- 4. GUARDA FINAL: o ACL nao mudou
do $acl$
declare
  v_acl text[];
begin
  select array_agg(s.g order by s.g)
    into v_acl
    from (select case when a.grantee = 0 then 'PUBLIC' else (select rolname from pg_roles where oid = a.grantee) end as g
            from pg_proc p, aclexplode(p.proacl) a
           where p.pronamespace = 'public'::regnamespace and p.proname = 'calcular_frete_transportadora') s;
  if v_acl is distinct from array['authenticated', 'postgres', 'service_role']::text[]
     or has_function_privilege('anon', 'public.calcular_frete_transportadora(text, text, numeric)', 'execute') then
    raise exception 'GUARDA FINAL: o ACL mudou (%).', v_acl;
  end if;
end;
$acl$;
