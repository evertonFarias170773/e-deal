-- ============================================================================
-- NFS-e: o rascunho aceita o texto das informacoes complementares (xInfComp)
-- ============================================================================
--
-- POR QUE
--   O n8n ja envia informacoes_complementares a Focus quando a nota tem texto
--   real. Faltava a criacao do rascunho aceitar esse texto: fn_criar_rascunho_nfse
--   nao citava a coluna, e o valor nascia sempre pela reserva do gatilho
--   ("NBS:<codigo>"). A janela do Vibe vai montar a condicao de pagamento e passa-la.
--
-- O QUE MUDA
--   fn_criar_rascunho_nfse  ganha p_informacoes_complementares text default null
--       (9o parametro, opcional). Com texto real, grava sem as bordas em branco e
--       cortado em 2.000 caracteres (corte, sem erro). Nulo ou vazio: igual a antes
--       (a coluna vai nula e o gatilho grava a reserva).
--       A assinatura muda (8 -> 9 parametros): a antiga e DERRUBADA e a nova criada
--       na mesma transacao (sem sobrecarga), com o ACL refeito para o de antes: so
--       postgres e service_role. Quem chama com os 8 nomes de antes continua valendo.
--   fn_clonar_rascunho_nfse  o clone so leva o texto da origem quando ele e a
--       reserva "NBS:<digitos>"; texto real vai nulo e o gatilho grava a reserva.
--       O endereco gravado (id_endereco_tomador) continua indo.
--
-- O QUE NAO MUDA
--   O gatilho tg_nfse_normalizar_recalcular_biu (ele so troca texto VAZIO pela
--   reserva; texto real e preservado), fn_montar_payload_nfse, as outras funcoes,
--   as notas existentes (nenhuma e regravada), NF-e, rotas, n8n, RLS e permissoes.
--
-- CONFERIDO DENTRO DA MIGRATION (aborta se falhar)
--   md5 de partida e md5 do corpo novo de cada funcao; md5 do gatilho; ACL; uma so
--   fn_criar_rascunho_nfse; md5 das 5 notas de maio (sem id_endereco_tomador);
--   linhas e payload de TODAS as notas identicos antes e depois.
--
--   funcao                     md5 antes                          md5 depois
--   fn_clonar_rascunho_nfse    68fd936ab3324d07a616f015582fa4ab   3f360b2d4d5bb1c4b1814a5da90a85a2
--   fn_criar_rascunho_nfse     709e2299f7c3d7343c2b67ae91e58727   b5eda6b7b60587c0454701d9c1cafe43
-- ============================================================================

do $migracao$
declare
  crlf constant text := chr(13) || chr(10);
  antiga_criar constant text := 'public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text, uuid)';
  nova_criar   constant text := 'public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text, uuid, text)';
  funcoes constant jsonb := $f$[
  {
    "nome": "fn_clonar_rascunho_nfse",
    "f": "public.fn_clonar_rascunho_nfse(text, text)",
    "antes": "68fd936ab3324d07a616f015582fa4ab",
    "depois": "3f360b2d4d5bb1c4b1814a5da90a85a2"
  },
  {
    "nome": "fn_criar_rascunho_nfse",
    "f": "public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text, uuid)",
    "antes": "709e2299f7c3d7343c2b67ae91e58727",
    "depois": "b5eda6b7b60587c0454701d9c1cafe43"
  }
]$f$::jsonb;
  t_alvo text[] := array['fn_clonar_rascunho_nfse', 'fn_criar_rascunho_nfse', 'fn_criar_rascunho_nfse', 'fn_criar_rascunho_nfse', 'fn_criar_rascunho_nfse', 'fn_criar_rascunho_nfse'];
  t_qtd  int[]  := array[1, 1, 1, 1, 1, 1];
  t_de   text[] := array[
    $t$    v_nfse_origem.informacoes_complementares,$t$,
    $t$p_id_endereco_tomador uuid DEFAULT NULL::uuid)$t$,
    $t$  v_discriminacao text;$t$,
    $t$  v_prefixo := 'NFS-' || p_id_int || '-';$t$,
    $t$    id_endereco_tomador,$t$,
    $t$    p_id_endereco_tomador,$t$
  ];
  t_para text[] := array[
    $t$    -- So a reserva "NBS:<codigo>" acompanha o clone. Texto real da nota de origem
    -- (ex.: condicao de pagamento) NAO vale para a nota nova: vai nulo e o gatilho
    -- grava a reserva.
    case
      when btrim(coalesce(v_nfse_origem.informacoes_complementares, '')) ~ '^NBS:[0-9]+$'
        then v_nfse_origem.informacoes_complementares
      else null
    end,$t$,
    $t$p_id_endereco_tomador uuid DEFAULT NULL::uuid, p_informacoes_complementares text DEFAULT NULL::text)$t$,
    $t$  v_discriminacao text;
  v_informacoes_complementares text;$t$,
    $t$  -- Informações complementares (xInfComp): texto real, sem as bordas em branco e
  -- com no máximo 2.000 caracteres. Vazio ou não informado fica nulo, e o gatilho
  -- da tabela grava a reserva "NBS:<código>", como sempre.
  v_informacoes_complementares := left(
    nullif(btrim(coalesce(p_informacoes_complementares, ''), ' ' || chr(9) || chr(10) || chr(13)), ''),
    2000
  );

  v_prefixo := 'NFS-' || p_id_int || '-';$t$,
    $t$    id_endereco_tomador,
    informacoes_complementares,$t$,
    $t$    p_id_endereco_tomador,
    v_informacoes_complementares,$t$
  ];
  f            jsonb;
  i            int;
  v_oid        oid;
  v_src        text;
  v_acl        text;
  v_secdef     boolean;
  v_config     text;
  v_def        text;
  v_de         text;
  v_para       text;
  v_n          int;
  v_depois     record;
  v_grantees   text;
  v_linhas_a   text;
  v_linhas_d   text;
  v_antigas    text;
  v_payload_a  text;
  v_payload_d  text;
begin
  -- 0. O ANTES
  if to_regprocedure(nova_criar) is not null then
    raise exception 'a funcao de 9 parametros ja existe. Abortado.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.tg_nfse_normalizar_recalcular_biu()')) is distinct from '9822964481d6aa3a0edbe86d3520d7a8' then
    raise exception 'o gatilho tg_nfse_normalizar_recalcular_biu mudou: reconferir se ele preserva texto real. Abortado.';
  end if;
  select md5(string_agg(md5((to_jsonb(s) - 'id_endereco_tomador')::text), ',' order by s.id)) into v_antigas
    from public.notas_servico s where s.created_at < '2026-06-01';
  if v_antigas is distinct from 'cd68a40fb52231d23b69aed9eb087051' then
    raise exception 'md5 das 5 notas antigas diferente do esperado: %', v_antigas;
  end if;
  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_linhas_a from public.notas_servico s;
  select md5(string_agg(s.ref || ':' || md5(public.fn_montar_payload_nfse(s.ref)::text), ',' order by s.ref)) into v_payload_a from public.notas_servico s;

  -- 1. As duas funcoes
  for f in select * from jsonb_array_elements(funcoes) loop
    v_oid := to_regprocedure(f ->> 'f');
    if v_oid is null then
      raise exception 'funcao % nao existe', f ->> 'f';
    end if;
    select p.prosrc, p.proacl::text, p.prosecdef, p.proconfig::text into v_src, v_acl, v_secdef, v_config from pg_proc p where p.oid = v_oid;
    if md5(v_src) <> (f ->> 'antes') then
      raise exception '% mudou desde a leitura (md5 %, esperado %). Abortado.', f ->> 'f', md5(v_src), f ->> 'antes';
    end if;

    v_def := pg_get_functiondef(v_oid);
    for i in 1 .. array_length(t_alvo, 1) loop
      continue when t_alvo[i] <> (f ->> 'nome');
      v_de   := replace(replace(t_de[i],   chr(13), ''), chr(10), crlf);
      v_para := replace(replace(t_para[i], chr(13), ''), chr(10), crlf);
      v_n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
      if v_n <> t_qtd[i] then
        raise exception '%: ancora % aparece % vez(es), esperava %', f ->> 'nome', i, v_n, t_qtd[i];
      end if;
      v_def := replace(v_def, v_de, v_para);
    end loop;

    if (f ->> 'nome') = 'fn_criar_rascunho_nfse' then
      -- a assinatura muda: sai a de 8 parametros, entra a de 9 (sem sobrecarga)
      execute 'drop function ' || antiga_criar;
      execute v_def;
      v_oid := to_regprocedure(nova_criar);
      if v_oid is null then
        raise exception 'a funcao nova % nao foi criada', nova_criar;
      end if;
      execute 'revoke all on function ' || nova_criar || ' from public, anon, authenticated';
      execute 'grant execute on function ' || nova_criar || ' to service_role';
    else
      execute v_def;
    end if;

    select p.prosrc, p.proacl::text as acl, p.prosecdef, p.proconfig::text as config into v_depois from pg_proc p where p.oid = v_oid;
    if md5(v_depois.prosrc) <> (f ->> 'depois') then
      raise exception '%: md5 do corpo novo % (esperado %)', f ->> 'nome', md5(v_depois.prosrc), f ->> 'depois';
    end if;
    if v_depois.prosecdef is distinct from v_secdef or v_depois.config is distinct from v_config then
      raise exception '%: secdef/config mudaram', f ->> 'nome';
    end if;
    select string_agg(distinct x.grantee::regrole::text, ',' order by x.grantee::regrole::text) into v_grantees
      from pg_proc p, aclexplode(p.proacl) x where p.oid = v_oid and x.privilege_type = 'EXECUTE';
    if v_grantees is distinct from 'postgres,service_role'
       or has_function_privilege('anon', v_oid, 'EXECUTE')
       or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception '%: ACL final inesperado (%)', f ->> 'nome', v_grantees;
    end if;
    if (f ->> 'nome') <> 'fn_criar_rascunho_nfse' and v_depois.acl is distinct from v_acl then
      raise exception '%: ACL mudou (% -> %)', f ->> 'nome', v_acl, v_depois.acl;
    end if;
  end loop;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fn_criar_rascunho_nfse') <> 1 then
    raise exception 'ficou sobrecarga de fn_criar_rascunho_nfse';
  end if;

  -- 2. O DEPOIS: nenhuma nota regravada, mesmo payload
  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_linhas_d from public.notas_servico s;
  if v_linhas_d is distinct from v_linhas_a then
    raise exception 'as linhas de notas_servico mudaram (% -> %)', v_linhas_a, v_linhas_d;
  end if;
  select md5(string_agg(s.ref || ':' || md5(public.fn_montar_payload_nfse(s.ref)::text), ',' order by s.ref)) into v_payload_d from public.notas_servico s;
  if v_payload_d is distinct from v_payload_a then
    raise exception 'o payload de alguma nota existente mudou (% -> %)', v_payload_a, v_payload_d;
  end if;

  perform pg_notify('pgrst', 'reload schema');
  raise notice 'ok: rascunho de NFS-e aceita informacoes complementares; 5 notas antigas md5 %; linhas e payloads identicos', v_antigas;
end
$migracao$;

-- ============================================================================
-- ROLLBACK (arquivos em supabase/manutencao/nfse-informacoes-complementares-rollback/)
-- ============================================================================
-- Os corpos anteriores, inteiros, estao em arquivos proprios; cada um confere o
-- md5 antes de recriar a funcao. Rodar os dois, em qualquer ordem:
--   fn_clonar_rascunho_nfse.sql
--   fn_criar_rascunho_nfse.sql   (derruba a de 9 parametros, recria a de 8 e o ACL)
-- ATENCAO: se a rota de rascunho ja estiver mandando p_informacoes_complementares,
-- o rollback da funcao de criar a quebra; voltar a rota antes.
-- Texto ja gravado em notas criadas depois da migration nao e apagado.
-- ============================================================================
