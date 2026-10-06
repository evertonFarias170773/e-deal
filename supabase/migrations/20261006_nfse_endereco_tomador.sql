-- ============================================================================
-- NFS-e: a nota passa a guardar o endereco do tomador escolhido na emissao
-- ============================================================================
--
-- POR QUE
--   fn_montar_payload_nfse escolhia "um" endereco do cliente ordenando por colunas
--   que a tabela enderecos nao tem (principal, padrao, tipo, created_at): todos
--   empatavam e saia um endereco qualquer. A tela de emissao vai deixar o
--   financeiro escolher; a escolha fica gravada na nota e e a usada no envio.
--
-- O QUE MUDA
--   notas_servico.id_endereco_tomador  uuid (tipo de enderecos.id), nula, sem
--       default e SEM chave estrangeira: a validacao e feita nas funcoes, para nao
--       criar efeito colateral na exclusao de enderecos.
--   fn_criar_rascunho_nfse  ganha p_id_endereco_tomador uuid default null. Informado,
--       tem de ser um endereco do p_id_cliente; se nao for, devolve
--       {ok:false, erro:'ENDERECO_TOMADOR_INVALIDO'} e nada e criado. Sem o
--       parametro, igual a antes. A assinatura muda, entao a funcao de 7 parametros
--       e DERRUBADA e a de 8 criada no lugar (nao fica sobrecarga); o ACL e refeito
--       para o mesmo de antes: so postgres e service_role.
--   fn_montar_payload_nfse  com endereco gravado na nota, usa exatamente esse (e so
--       se for do cliente da nota); nunca troca por outro. Sem endereco gravado,
--       comportamento de antes.
--   fn_alertas_nfse  os tres alertas de endereco passam a olhar so o endereco
--       gravado, quando ha; dois alertas novos, que nao bloqueiam:
--       ENDERECO_TOMADOR_GRAVADO_INVALIDO (nao existe mais ou e de outro cliente) e
--       ENDERECO_TOMADOR_TEXTO_INVALIDO ("[object Object]" ou "NULL" em algum
--       campo). Sem endereco gravado, igual a antes.
--   fn_clonar_rascunho_nfse  leva o id_endereco_tomador da nota de origem.
--
-- O QUE NAO MUDA
--   Nenhuma nota existente e regravada: a coluna nasce nula em todas, e o payload e
--   os alertas de cada nota existente sao conferidos antes e depois, na mesma
--   transacao. NF-e, rotas, n8n, RLS e permissoes nao sao tocados. Nenhum GRANT para
--   anon ou authenticated.
--
-- COMO E FEITA
--   As quatro funcoes nao tem arquivo de criacao no repositorio. A troca e ancorada
--   no corpo VIVO: so segue se o md5 de cada corpo for o lido em 05/10/2026 e se
--   cada ancora aparecer o numero esperado de vezes; confere o md5 do corpo novo.
--
--   funcao                     md5 antes                          md5 depois
--   fn_montar_payload_nfse     8bebe2834b97ed5c0177132fac6c617e   e6293fc027bccaf5a37ed36de95c9892
--   fn_alertas_nfse            49cf26b476b64f1cf740a242a28edf2d   70d8e050cfb8eb940f9e2d7668a57a71
--   fn_clonar_rascunho_nfse    a27ac7994f258f44420312f4af818b88   68fd936ab3324d07a616f015582fa4ab
--   fn_criar_rascunho_nfse     3f312b21338d04daed2eb601e47c48ab   709e2299f7c3d7343c2b67ae91e58727
--
-- ACHADO QUE FICA COMO ESTA (fora do escopo)
--   Sem endereco gravado, a escolha continua arbitraria. E o codigo do municipio do
--   tomador so sai para Porto Alegre e Avare: a funcao procura a coluna do codigo
--   IBGE em enderecos (que nao existe) e cai num de-para fixo dessas duas cidades.
-- ============================================================================

do $migracao$
declare
  crlf constant text := chr(13) || chr(10);
  funcoes constant jsonb := $f$[
  {
    "nome": "fn_montar_payload_nfse",
    "f": "public.fn_montar_payload_nfse(text)",
    "antes": "8bebe2834b97ed5c0177132fac6c617e",
    "depois": "e6293fc027bccaf5a37ed36de95c9892"
  },
  {
    "nome": "fn_alertas_nfse",
    "f": "public.fn_alertas_nfse(text)",
    "antes": "49cf26b476b64f1cf740a242a28edf2d",
    "depois": "70d8e050cfb8eb940f9e2d7668a57a71"
  },
  {
    "nome": "fn_clonar_rascunho_nfse",
    "f": "public.fn_clonar_rascunho_nfse(text, text)",
    "antes": "a27ac7994f258f44420312f4af818b88",
    "depois": "68fd936ab3324d07a616f015582fa4ab"
  },
  {
    "nome": "fn_criar_rascunho_nfse",
    "f": "public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text)",
    "antes": "3f312b21338d04daed2eb601e47c48ab",
    "depois": "709e2299f7c3d7343c2b67ae91e58727"
  }
]$f$::jsonb;
  t_alvo text[] := array['fn_montar_payload_nfse', 'fn_alertas_nfse', 'fn_alertas_nfse', 'fn_clonar_rascunho_nfse', 'fn_clonar_rascunho_nfse', 'fn_criar_rascunho_nfse', 'fn_criar_rascunho_nfse', 'fn_criar_rascunho_nfse', 'fn_criar_rascunho_nfse', 'fn_criar_rascunho_nfse'];
  t_qtd  int[]  := array[1, 3, 1, 1, 1, 1, 1, 1, 1, 1];
  t_de   text[] := array[
    $t$where ed.id_cliente = ns.id_cliente$t$,
    $t$public.enderecos ed on ed.id_cliente = ns.id_cliente$t$,
    $t$  -- Serviço padrão não informado$t$,
    $t$    forma_pagamento,$t$,
    $t$v_nfse_origem.forma_pagamento,$t$,
    $t$p_criado_por_nome text DEFAULT 'FlutterFlow'::text)$t$,
    $t$  v_id_empresa := coalesce(p_id_empresa, 2);$t$,
    $t$    criado_por_nome,$t$,
    $t$    p_criado_por_nome,$t$,
    $t$    'id_cliente', p_id_cliente,$t$
  ];
  t_para text[] := array[
    $t$where ed.id_cliente = ns.id_cliente
      and (ns.id_endereco_tomador is null or ed.id = ns.id_endereco_tomador)$t$,
    $t$public.enderecos ed on ed.id_cliente = ns.id_cliente and (ns.id_endereco_tomador is null or ed.id = ns.id_endereco_tomador)$t$,
    $t$  -- Endereço do tomador gravado na nota não existe mais ou é de outro cliente
  return query
  select
    'ALERTA'::text,
    'ENDERECO_TOMADOR_GRAVADO_INVALIDO'::text,
    'O endereço do tomador gravado na NFS-e não existe mais ou não pertence ao tomador. A NFS-e sairá sem endereço do tomador.'::text,
    false
  from public.notas_servico ns
  where ns.ref = p_ref
    and ns.id_endereco_tomador is not null
    and not exists (
      select 1
      from public.enderecos ed
      where ed.id = ns.id_endereco_tomador
        and ed.id_cliente = ns.id_cliente
    );

  -- Endereço do tomador gravado na nota com texto inválido em algum campo
  return query
  select
    'ALERTA'::text,
    'ENDERECO_TOMADOR_TEXTO_INVALIDO'::text,
    'O endereço do tomador gravado na NFS-e tem texto inválido ("[object Object]" ou "NULL") em algum campo. Corrija o cadastro do endereço: a NFS-e sairá sem endereço do tomador.'::text,
    false
  from public.notas_servico ns
  join public.enderecos ed
    on ed.id = ns.id_endereco_tomador
   and ed.id_cliente = ns.id_cliente
  where ns.ref = p_ref
    and exists (
      select 1
      from jsonb_each_text(to_jsonb(ed) - 'id') k
      where k.value like '%[object Object]%'
         or upper(trim(k.value)) = 'NULL'
    );

  -- Serviço padrão não informado$t$,
    $t$    id_endereco_tomador,
    forma_pagamento,$t$,
    $t$v_nfse_origem.id_endereco_tomador,
    v_nfse_origem.forma_pagamento,$t$,
    $t$p_criado_por_nome text DEFAULT 'FlutterFlow'::text, p_id_endereco_tomador uuid DEFAULT NULL::uuid)$t$,
    $t$  -- Endereço do tomador escolhido na emissão: tem de ser do próprio tomador
  if p_id_endereco_tomador is not null and not exists (
    select 1
    from public.enderecos ed
    where ed.id = p_id_endereco_tomador
      and ed.id_cliente = p_id_cliente
  ) then
    return jsonb_build_object(
      'ok', false,
      'erro', 'ENDERECO_TOMADOR_INVALIDO',
      'mensagem', 'O endereço informado não pertence ao tomador da NFS-e.'
    );
  end if;

  v_id_empresa := coalesce(p_id_empresa, 2);$t$,
    $t$    id_endereco_tomador,
    criado_por_nome,$t$,
    $t$    p_id_endereco_tomador,
    p_criado_por_nome,$t$,
    $t$    'id_cliente', p_id_cliente,
    'id_endereco_tomador', p_id_endereco_tomador,$t$
  ];
  nova_criar constant text := 'public.fn_criar_rascunho_nfse(bigint, bigint, bigint, bigint, numeric, text, text, uuid)';
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
  v_antigas_a  text;
  v_antigas_d  text;
  v_payload_a  text;
  v_payload_d  text;
  v_alertas_a  text;
  v_alertas_d  text;
begin
  -- 0. O ANTES
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notas_servico' and column_name = 'id_endereco_tomador') then
    raise exception 'a coluna id_endereco_tomador ja existe. Abortado.';
  end if;
  if (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'enderecos' and column_name = 'id') <> 'uuid' then
    raise exception 'enderecos.id nao e uuid. Abortado.';
  end if;

  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_linhas_a from public.notas_servico s;
  select md5(string_agg(md5(to_jsonb(s)::text), ',' order by s.id)) into v_antigas_a from public.notas_servico s where s.ref !~ '^NFS-(22552|22823|22821|22820)-';
  if v_antigas_a is distinct from 'cd68a40fb52231d23b69aed9eb087051' then
    raise exception 'md5 das 5 notas antigas diferente do esperado: %', v_antigas_a;
  end if;
  select md5(string_agg(s.ref || ':' || md5(public.fn_montar_payload_nfse(s.ref)::text), ',' order by s.ref)) into v_payload_a from public.notas_servico s;
  select md5(string_agg(s.ref || ':' || (
           select coalesce(string_agg(a.tipo || '|' || a.codigo || '|' || a.mensagem || '|' || a.bloqueia_envio, ';' order by a.codigo, a.tipo, a.mensagem), '')
             from public.fn_alertas_nfse(s.ref) a), ',' order by s.ref))
    into v_alertas_a from public.notas_servico s;

  -- 1. A coluna: nula, sem default, sem chave estrangeira
  alter table public.notas_servico add column id_endereco_tomador uuid;
  comment on column public.notas_servico.id_endereco_tomador is
    'Endereco do tomador (enderecos.id) escolhido na emissao. Nulo = a funcao de payload escolhe como antes. Sem FK de proposito: a validacao e das funcoes de NFS-e.';

  -- 2. As quatro funcoes
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
      -- a assinatura muda: sai a de 7 parametros, entra a de 8 (sem sobrecarga)
      execute 'drop function ' || (f ->> 'f');
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
    if (f ->> 'nome') = 'fn_criar_rascunho_nfse' then
      if v_grantees is distinct from 'postgres,service_role'
         or has_function_privilege('anon', v_oid, 'EXECUTE')
         or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
        raise exception 'fn_criar_rascunho_nfse: ACL final inesperado (%)', v_grantees;
      end if;
    elsif v_depois.acl is distinct from v_acl then
      raise exception '%: ACL mudou (% -> %)', f ->> 'nome', v_acl, v_depois.acl;
    end if;
  end loop;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fn_criar_rascunho_nfse') <> 1 then
    raise exception 'ficou sobrecarga de fn_criar_rascunho_nfse';
  end if;

  -- 3. O DEPOIS: nenhuma nota regravada, mesmo payload e mesmos alertas
  if exists (select 1 from public.notas_servico where id_endereco_tomador is not null) then
    raise exception 'alguma nota ficou com endereco gravado';
  end if;
  select md5(string_agg(md5((to_jsonb(s) - 'id_endereco_tomador')::text), ',' order by s.id)) into v_linhas_d from public.notas_servico s;
  select md5(string_agg(md5((to_jsonb(s) - 'id_endereco_tomador')::text), ',' order by s.id)) into v_antigas_d from public.notas_servico s where s.ref !~ '^NFS-(22552|22823|22821|22820)-';
  if v_linhas_d is distinct from v_linhas_a or v_antigas_d is distinct from v_antigas_a then
    raise exception 'as linhas de notas_servico mudaram (% -> %)', v_linhas_a, v_linhas_d;
  end if;
  select md5(string_agg(s.ref || ':' || md5(public.fn_montar_payload_nfse(s.ref)::text), ',' order by s.ref)) into v_payload_d from public.notas_servico s;
  if v_payload_d is distinct from v_payload_a then
    raise exception 'o payload de alguma nota existente mudou (% -> %)', v_payload_a, v_payload_d;
  end if;
  select md5(string_agg(s.ref || ':' || (
           select coalesce(string_agg(a.tipo || '|' || a.codigo || '|' || a.mensagem || '|' || a.bloqueia_envio, ';' order by a.codigo, a.tipo, a.mensagem), '')
             from public.fn_alertas_nfse(s.ref) a), ',' order by s.ref))
    into v_alertas_d from public.notas_servico s;
  if v_alertas_d is distinct from v_alertas_a then
    raise exception 'os alertas de alguma nota existente mudaram (% -> %)', v_alertas_a, v_alertas_d;
  end if;

  perform pg_notify('pgrst', 'reload schema');
  raise notice 'ok: endereco do tomador na NFS-e; 5 notas antigas md5 %; payload e alertas das notas existentes identicos', v_antigas_d;
end
$migracao$;

-- ============================================================================
-- ROLLBACK (arquivos em supabase/manutencao/nfse-endereco-tomador-rollback/)
-- ============================================================================
-- Os corpos anteriores, inteiros, estao em arquivos proprios; cada um confere o
-- md5 antes de recriar a funcao. Rodar NESTA ordem:
--   1. fn_clonar_rascunho_nfse.sql
--   2. fn_alertas_nfse.sql
--   3. fn_montar_payload_nfse.sql
--   4. fn_criar_rascunho_nfse.sql   (derruba a de 8 parametros, recria a de 7 e o ACL)
--   5. zz_drop_coluna.sql           (so depois das quatro: as funcoes novas citam a coluna)
-- O passo 5 apaga a escolha de endereco das notas criadas depois desta migration.
-- ============================================================================
