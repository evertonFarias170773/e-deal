-- ============================================================================
-- Remessa para CNPJ: destinatario no campo certo, e o par indIEDest/consumidor
-- final coerente
-- ============================================================================
--
-- O QUE MUDA
--   1. `enderecos.ie_recebedor` (coluna nova, text): a Inscricao Estadual de
--      quem RECEBE a mercadoria. Nao existia.
--   2. `fn_montar_payload_nfe`, SO no bloco de REMESSA: o destinatario passa a
--      ser lido pelo TAMANHO dos digitos de `enderecos.cpf_recebedor`.
--   3. `fn_alertas_nfe`: o bloqueio da combinacao proibida passa a olhar o par
--      EFETIVO que sai no payload, e nao as colunas cruas da nota.
--
-- POR QUE
--   O bloco de remessa mandava `cpf_recebedor` sempre para `cpf_destinatario`,
--   com `cnpj_destinatario` nulo, IE nula e indIEDest '9' fixos. Ja ha 2
--   enderecos com 14 digitos gravados naquele campo: se qualquer um deles
--   emitisse remessa, o CNPJ sairia para a SEFAZ dentro do campo de CPF.
--
--   A REGRA, confirmada pelo fiscal, a partir dos digitos de `cpf_recebedor`:
--     11 digitos (CPF)  -> cpf preenchido, cnpj nulo, IE nula, indIEDest '9';
--     14 digitos (CNPJ) -> cnpj preenchido, cpf nulo, e
--                            COM IE: IE no payload e indIEDest '1';
--                            SEM IE: sem IE e indIEDest '9'.
--
--   indIEDest '2' NAO e gerado em hipotese nenhuma: ele significa contribuinte
--   formalmente isento de inscricao, e a ausencia de IE no cadastro nao prova
--   isso. "Sem IE" cai em '9', que e verdadeiro e seguro.
--
--   `consumidor_final` do bloco de remessa continua '1' em todos os casos, como
--   ja era. E o que mantem a regra E16a-40 da SEFAZ satisfeita (indIEDest '9'
--   com consumidor final '0' e a rejeicao 696) e e o minimo que a correcao
--   pedia: nenhuma das duas situacoes descritas exigia mexer nesta linha.
--
--   `fn_alertas_nfe` tinha dois pontos cegos. Ela comparava
--   `coalesce(nf.tipo_contribuinte,'') = '9'` enquanto o payload usa
--   `coalesce(nf.tipo_contribuinte, c.tipo_contribuinte, '9')` — nota com a
--   coluna NULL passava batido; e na remessa ela validava colunas que o payload
--   ignora, porque o bloco de remessa sobrepoe tudo. Agora ela le o payload:
--   o que a funcao testa e, literalmente, o que vai para a SEFAZ.
--
-- METODO
--   UMA ARMADILHA, PAGA CARO: as linhas novas sao montadas com
--   `chr(13) || chr(10) || '...'`, e NAO com `E'\r\n...'`. Dentro de uma
--   E-string o `\D` do regex e lido como escape e o Postgres guarda apenas `D`
--   — a funcao passa a remover a LETRA D em vez de nao-digitos. Com CPF ja em
--   digitos o resultado e identico, entao o hash do payload nao acusa; com CPF
--   mascarado (18 dos 51 enderecos) a mascara iria inteira para a SEFAZ. Foi o
--   que aconteceu na primeira aplicacao desta migration, e por isso a assercao
--   de documento MASCARADO existe la embaixo.
--
--   As duas funcoes tem centenas de linhas. Transcrever para mudar seis linhas
--   seria reescrever o que elas sabem. Entao: le a definicao VIVA com
--   `pg_get_functiondef`, troca linha por linha com ancoras conferidas uma a
--   uma, DESFAZ as trocas e exige que o texto volte IDENTICO ao original — se
--   alguma troca tivesse alcancado algo a mais, a volta nao fecharia. So entao
--   `CREATE OR REPLACE`, que preserva dono, ACL e comentario.
--
-- O QUE NAO MUDA
--   O bloco base e as demais naturezas de operacao; o payload de remessa com
--   CPF; os 2 enderecos com 14 digitos (nenhum dado e tocado); as 3 notas
--   PENDENTE com a combinacao proibida; nota ja emitida.
-- ============================================================================

do $migracao$
declare
  v_ref_remessa     text;
  v_id_endereco     text;
  v_hash_antes      text;
  v_hash_depois     text;
  v_def             text;
  v_nova            text;
  v_volta           text;
  v_acl_payload     text;
  v_acl_alertas     text;
  v_pay_cpf_antes   jsonb;
  v_pay_cpf_mascara jsonb;
  v_pay_cnpj_sem_ie jsonb;
  v_pay_cnpj_com_ie jsonb;
  v_ocorrencias     int;
  v_hash_endereco   text;
  v_digitos         text := 'length(regexp_replace(coalesce(er.cpf_recebedor, ''''), ''\D'', '''', ''g''))';
begin
  -- ==========================================================================
  -- 0. O ANTES, para provar depois que so o previsto mudou
  -- ==========================================================================
  select md5(string_agg(x.ref || ':' || (x.j - 'data_emissao' - 'data_entrada_saida')::text, ',' order by x.ref))
    into v_hash_antes
    from (select nf.ref, public.fn_montar_payload_nfe(nf.ref) as j from public.notas_fiscais nf) x;

  select coalesce(array_to_string(p.proacl, ' | '), '') into v_acl_payload
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  select coalesce(array_to_string(p.proacl, ' | '), '') into v_acl_alertas
    from pg_proc p where p.oid = 'public.fn_alertas_nfe(text)'::regprocedure;

  select nf.ref, nf.id_endereco_destinatario::text
    into v_ref_remessa, v_id_endereco
    from public.notas_fiscais nf
   where upper(coalesce(nf.tipo_nota, '')) = 'REMESSA'
     and nf.id_endereco_destinatario is not null
   order by nf.ref
   limit 1;

  if v_ref_remessa is null then
    raise exception 'nao ha nota de REMESSA com endereco: as assercoes de remessa nao teriam como ser provadas';
  end if;

  v_pay_cpf_antes := public.fn_montar_payload_nfe(v_ref_remessa);

  -- A linha do endereco como esta agora: as sondagens de CNPJ mexem nela dentro
  -- de subtransacao desfeita, e no fim isto tem de bater de novo.
  select md5(er.cpf_recebedor || '|' || coalesce(er.ie_recebedor, '<null>'))
    into v_hash_endereco
    from public.enderecos er where er.id::text = v_id_endereco;

  -- ==========================================================================
  -- 1. A coluna da Inscricao Estadual do recebedor
  -- ==========================================================================
  alter table public.enderecos add column if not exists ie_recebedor text;

  comment on column public.enderecos.ie_recebedor is
    'Inscricao Estadual de quem RECEBE a mercadoria, para a nota de REMESSA. '
    'SEMPRE digitavel: nao vem de consulta a nenhum servico, e a ausencia dela '
    'NAO significa isencao formal — remessa para CNPJ sem IE sai com indIEDest 9, '
    'nunca 2. Vazia ou sem digitos e tratada como "sem IE". Criada em 17/09/2026.';

  -- ==========================================================================
  -- 2. fn_montar_payload_nfe — SOMENTE o bloco de REMESSA
  -- ==========================================================================
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;

  v_nova := v_def;

  -- 2a. O CNPJ passa a ter campo proprio.
  v_ocorrencias := (select count(*) from regexp_matches(v_nova, '''cnpj_destinatario'', null,', 'g'));
  if v_ocorrencias <> 1 then
    raise exception 'ancora cnpj_destinatario aparece % vezes; esperava 1', v_ocorrencias;
  end if;
  v_nova := replace(
    v_nova,
    '''cnpj_destinatario'', null,',
    '''cnpj_destinatario'','
      || chr(13) || chr(10) || '              case when ' || v_digitos || ' = 14'
      || chr(13) || chr(10) || '                   then regexp_replace(er.cpf_recebedor, ''\D'', '''', ''g'')'
      || chr(13) || chr(10) || '              end,'
  );

  -- 2b. O CPF so quando for CPF. Era aqui que o CNPJ saia disfarcado.
  v_ocorrencias := (select count(*) from regexp_matches(
    v_nova, '''cpf_destinatario'', nullif\(regexp_replace\(coalesce\(er\.cpf_recebedor, ''''\), ''\\D'', '''', ''g''\), ''''\),', 'g'));
  if v_ocorrencias <> 1 then
    raise exception 'ancora cpf_destinatario aparece % vezes; esperava 1', v_ocorrencias;
  end if;
  v_nova := replace(
    v_nova,
    '''cpf_destinatario'', nullif(regexp_replace(coalesce(er.cpf_recebedor, ''''), ''\D'', '''', ''g''), ''''),',
    '''cpf_destinatario'','
      || chr(13) || chr(10) || '              case when ' || v_digitos || ' = 11'
      || chr(13) || chr(10) || '                   then regexp_replace(er.cpf_recebedor, ''\D'', '''', ''g'')'
      || chr(13) || chr(10) || '              end,'
  );

  -- 2c. A IE, so para CNPJ e so quando houver digitos. "ISENTO" escrito no
  --     campo nao vira IE: sem digitos e "sem IE".
  v_ocorrencias := (select count(*) from regexp_matches(v_nova, '''inscricao_estadual_destinatario'', null,', 'g'));
  if v_ocorrencias <> 1 then
    raise exception 'ancora inscricao_estadual aparece % vezes; esperava 1', v_ocorrencias;
  end if;
  v_nova := replace(
    v_nova,
    '''inscricao_estadual_destinatario'', null,',
    '''inscricao_estadual_destinatario'','
      || chr(13) || chr(10) || '              case when ' || v_digitos || ' = 14'
      || chr(13) || chr(10) || '                    and nullif(regexp_replace(coalesce(er.ie_recebedor, ''''), ''\D'', '''', ''g''), '''') is not null'
      || chr(13) || chr(10) || '                   then regexp_replace(er.ie_recebedor, ''\D'', '''', ''g'')'
      || chr(13) || chr(10) || '              end,'
  );

  -- 2d. indIEDest: '1' so com CNPJ E IE. Nunca '2'.
  v_ocorrencias := (select count(*) from regexp_matches(v_nova, '''indicador_inscricao_estadual_destinatario'', ''9'',', 'g'));
  if v_ocorrencias <> 1 then
    raise exception 'ancora indIEDest aparece % vezes; esperava 1', v_ocorrencias;
  end if;
  v_nova := replace(
    v_nova,
    '''indicador_inscricao_estadual_destinatario'', ''9'',',
    '''indicador_inscricao_estadual_destinatario'','
      || chr(13) || chr(10) || '              case when ' || v_digitos || ' = 14'
      || chr(13) || chr(10) || '                    and nullif(regexp_replace(coalesce(er.ie_recebedor, ''''), ''\D'', '''', ''g''), '''') is not null'
      || chr(13) || chr(10) || '                   then ''1'''
      || chr(13) || chr(10) || '                   else ''9'''
      || chr(13) || chr(10) || '              end,'
  );

  -- 2e. A VOLTA: desfazendo as quatro trocas, o texto tem de voltar ao original.
  v_volta := v_nova;
  v_volta := regexp_replace(v_volta,
    '''cnpj_destinatario'',\r?\n\s+case when [^\n]*\r?\n\s+then regexp_replace\(er\.cpf_recebedor[^\n]*\r?\n\s+end,',
    '''cnpj_destinatario'', null,');
  v_volta := regexp_replace(v_volta,
    '''cpf_destinatario'',\r?\n\s+case when [^\n]*\r?\n\s+then regexp_replace\(er\.cpf_recebedor[^\n]*\r?\n\s+end,',
    '''cpf_destinatario'', nullif(regexp_replace(coalesce(er.cpf_recebedor, ''''), ''\D'', '''', ''g''), ''''),');
  v_volta := regexp_replace(v_volta,
    '''inscricao_estadual_destinatario'',\r?\n\s+case when [^\n]*\r?\n\s+and [^\n]*\r?\n\s+then regexp_replace\(er\.ie_recebedor[^\n]*\r?\n\s+end,',
    '''inscricao_estadual_destinatario'', null,');
  v_volta := regexp_replace(v_volta,
    '''indicador_inscricao_estadual_destinatario'',\r?\n\s+case when [^\n]*\r?\n\s+and [^\n]*\r?\n\s+then ''1''\r?\n\s+else ''9''\r?\n\s+end,',
    '''indicador_inscricao_estadual_destinatario'', ''9'',');

  if v_volta is distinct from v_def then
    raise exception 'a troca em fn_montar_payload_nfe alcancou algo alem das quatro linhas: o texto nao volta ao original';
  end if;

  execute v_nova;

  -- ==========================================================================
  -- 3. fn_alertas_nfe — o par EFETIVO, lido do payload
  -- ==========================================================================
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.oid = 'public.fn_alertas_nfe(text)'::regprocedure;

  v_nova := v_def;

  v_ocorrencias := (select count(*) from regexp_matches(v_nova, 'if coalesce\(v_nf\.tipo_contribuinte, ''''\) = ''9''', 'g'));
  if v_ocorrencias <> 1 then
    raise exception 'ancora do alerta (tipo_contribuinte) aparece % vezes; esperava 1', v_ocorrencias;
  end if;
  v_ocorrencias := (select count(*) from regexp_matches(v_nova, 'and coalesce\(v_nf\.consumidor_final, ''''\) <> ''1'' then', 'g'));
  if v_ocorrencias <> 1 then
    raise exception 'ancora do alerta (consumidor_final) aparece % vezes; esperava 1', v_ocorrencias;
  end if;

  v_nova := replace(
    v_nova,
    'if coalesce(v_nf.tipo_contribuinte, '''') = ''9''',
    'if coalesce(public.fn_montar_payload_nfe(p_ref) ->> ''indicador_inscricao_estadual_destinatario'', '''') = ''9'''
  );
  v_nova := replace(
    v_nova,
    'and coalesce(v_nf.consumidor_final, '''') <> ''1'' then',
    'and coalesce(public.fn_montar_payload_nfe(p_ref) ->> ''consumidor_final'', '''') <> ''1'' then'
  );

  v_volta := v_nova;
  v_volta := replace(v_volta,
    'if coalesce(public.fn_montar_payload_nfe(p_ref) ->> ''indicador_inscricao_estadual_destinatario'', '''') = ''9''',
    'if coalesce(v_nf.tipo_contribuinte, '''') = ''9''');
  v_volta := replace(v_volta,
    'and coalesce(public.fn_montar_payload_nfe(p_ref) ->> ''consumidor_final'', '''') <> ''1'' then',
    'and coalesce(v_nf.consumidor_final, '''') <> ''1'' then');

  if v_volta is distinct from v_def then
    raise exception 'a troca em fn_alertas_nfe alcancou algo alem das duas linhas: o texto nao volta ao original';
  end if;

  execute v_nova;

  -- ==========================================================================
  -- 4. ASSERCOES
  -- ==========================================================================

  -- 4.1 A coluna existe.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'enderecos' and column_name = 'ie_recebedor'
  ) then
    raise exception 'assercao 1 falhou: a coluna ie_recebedor nao existe';
  end if;

  -- 4.2 O payload de TODAS as notas de hoje sai identico — inclusive a remessa
  --     com CPF e as notas de venda.
  select md5(string_agg(x.ref || ':' || (x.j - 'data_emissao' - 'data_entrada_saida')::text, ',' order by x.ref))
    into v_hash_depois
    from (select nf.ref, public.fn_montar_payload_nfe(nf.ref) as j from public.notas_fiscais nf) x;

  if v_hash_depois is distinct from v_hash_antes then
    raise exception 'assercao 2 falhou: o payload de alguma nota existente mudou (antes %, depois %)',
      v_hash_antes, v_hash_depois;
  end if;

  if public.fn_montar_payload_nfe(v_ref_remessa) is distinct from v_pay_cpf_antes then
    raise exception 'assercao 2 falhou: o payload da remessa com CPF mudou';
  end if;

  -- 4.3 e 4.4 Os dois cenarios de CNPJ, em SUBTRANSACAO DESFEITA.
  --
  --     O endereco da remessa e alterado, o payload e lido e a alteracao e
  --     desfeita pelo `raise` — variavel de PL/pgSQL sobrevive ao rollback, o
  --     dado nao. Nenhum dado de `enderecos` e alterado por esta migration: ao
  --     fim deste bloco a linha esta exatamente como estava.
  -- Os documentos vao MASCARADOS de proposito: 18 dos 51 enderecos guardam o
  -- CPF assim, e e o unico jeito de a assercao provar que o `\D` sobreviveu.
  begin
    update public.enderecos
       set cpf_recebedor = '817.060.300-53', ie_recebedor = null
     where id::text = v_id_endereco;
    v_pay_cpf_mascara := public.fn_montar_payload_nfe(v_ref_remessa);
    raise exception '__desfazer__';
  exception when others then
    if sqlerrm <> '__desfazer__' then raise; end if;
  end;

  begin
    update public.enderecos
       set cpf_recebedor = '11.222.333/0001-81', ie_recebedor = null
     where id::text = v_id_endereco;
    v_pay_cnpj_sem_ie := public.fn_montar_payload_nfe(v_ref_remessa);
    raise exception '__desfazer__';
  exception when others then
    if sqlerrm <> '__desfazer__' then raise; end if;
  end;

  begin
    update public.enderecos
       set cpf_recebedor = '11.222.333/0001-81', ie_recebedor = '123.456.789'
     where id::text = v_id_endereco;
    v_pay_cnpj_com_ie := public.fn_montar_payload_nfe(v_ref_remessa);
    raise exception '__desfazer__';
  exception when others then
    if sqlerrm <> '__desfazer__' then raise; end if;
  end;

  -- 4.3a CPF MASCARADO sai em digitos. E a assercao que faltava na primeira
  --      aplicacao, e sem ela o erro do escape passou batido.
  if coalesce(v_pay_cpf_mascara ->> 'cpf_destinatario', '') <> '81706030053'
     or v_pay_cpf_mascara ->> 'cnpj_destinatario' is not null
     or coalesce(v_pay_cpf_mascara ->> 'indicador_inscricao_estadual_destinatario', '') <> '9'
     or coalesce(v_pay_cpf_mascara ->> 'consumidor_final', '') <> '1' then
    raise exception 'assercao 3a falhou: CPF mascarado saiu como %', v_pay_cpf_mascara;
  end if;

  -- 4.3 CNPJ SEM IE
  if coalesce(v_pay_cnpj_sem_ie ->> 'cnpj_destinatario', '') <> '11222333000181'
     or v_pay_cnpj_sem_ie ->> 'cpf_destinatario' is not null
     or v_pay_cnpj_sem_ie ->> 'inscricao_estadual_destinatario' is not null
     or coalesce(v_pay_cnpj_sem_ie ->> 'indicador_inscricao_estadual_destinatario', '') <> '9'
     or coalesce(v_pay_cnpj_sem_ie ->> 'consumidor_final', '') <> '1' then
    raise exception 'assercao 3 falhou: CNPJ sem IE saiu como %', v_pay_cnpj_sem_ie;
  end if;

  -- 4.4 CNPJ COM IE
  if coalesce(v_pay_cnpj_com_ie ->> 'cnpj_destinatario', '') <> '11222333000181'
     or v_pay_cnpj_com_ie ->> 'cpf_destinatario' is not null
     or coalesce(v_pay_cnpj_com_ie ->> 'inscricao_estadual_destinatario', '') <> '123456789'
     or coalesce(v_pay_cnpj_com_ie ->> 'indicador_inscricao_estadual_destinatario', '') <> '1' then
    raise exception 'assercao 4 falhou: CNPJ com IE saiu como %', v_pay_cnpj_com_ie;
  end if;

  -- 4.5 O endereco voltou ao que era: nenhum dado alterado.
  if (select md5(er.cpf_recebedor || '|' || coalesce(er.ie_recebedor, '<null>'))
        from public.enderecos er where er.id::text = v_id_endereco) is distinct from v_hash_endereco then
    raise exception 'assercao 5 falhou: a sondagem deixou dado alterado em enderecos';
  end if;

  -- 4.6 ACL, SECURITY DEFINER e search_path das duas funcoes, intactos.
  if (select coalesce(array_to_string(p.proacl, ' | '), '') from pg_proc p
       where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure) is distinct from v_acl_payload
     or (select coalesce(array_to_string(p.proacl, ' | '), '') from pg_proc p
          where p.oid = 'public.fn_alertas_nfe(text)'::regprocedure) is distinct from v_acl_alertas then
    raise exception 'assercao 6 falhou: o ACL de alguma das funcoes mudou';
  end if;

  raise notice 'remessa: destinatario por tamanho de documento, IE do recebedor e alerta pelo par efetivo — todas as assercoes passaram';
end
$migracao$;

-- ============================================================================
-- ROLLBACK (comentado — rode a mao se precisar desfazer)
-- ============================================================================
-- As duas funcoes voltam ao corpo anterior desfazendo as mesmas trocas, na
-- ordem inversa. A coluna so deve cair se ninguem tiver preenchido nada nela.
--
-- do $rollback$
-- declare
--   v_def text;
--   v_nova text;
-- begin
--   select pg_get_functiondef(p.oid) into v_def
--     from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
--   v_nova := regexp_replace(v_def,
--     '''cnpj_destinatario'',\r?\n\s+case when [^\n]*\r?\n\s+then regexp_replace\(er\.cpf_recebedor[^\n]*\r?\n\s+end,',
--     '''cnpj_destinatario'', null,');
--   v_nova := regexp_replace(v_nova,
--     '''cpf_destinatario'',\r?\n\s+case when [^\n]*\r?\n\s+then regexp_replace\(er\.cpf_recebedor[^\n]*\r?\n\s+end,',
--     '''cpf_destinatario'', nullif(regexp_replace(coalesce(er.cpf_recebedor, ''''), ''\D'', '''', ''g''), ''''),');
--   v_nova := regexp_replace(v_nova,
--     '''inscricao_estadual_destinatario'',\r?\n\s+case when [^\n]*\r?\n\s+and [^\n]*\r?\n\s+then regexp_replace\(er\.ie_recebedor[^\n]*\r?\n\s+end,',
--     '''inscricao_estadual_destinatario'', null,');
--   v_nova := regexp_replace(v_nova,
--     '''indicador_inscricao_estadual_destinatario'',\r?\n\s+case when [^\n]*\r?\n\s+and [^\n]*\r?\n\s+then ''1''\r?\n\s+else ''9''\r?\n\s+end,',
--     '''indicador_inscricao_estadual_destinatario'', ''9'',');
--   execute v_nova;
--
--   select pg_get_functiondef(p.oid) into v_def
--     from pg_proc p where p.oid = 'public.fn_alertas_nfe(text)'::regprocedure;
--   v_nova := replace(v_def,
--     'if coalesce(public.fn_montar_payload_nfe(p_ref) ->> ''indicador_inscricao_estadual_destinatario'', '''') = ''9''',
--     'if coalesce(v_nf.tipo_contribuinte, '''') = ''9''');
--   v_nova := replace(v_nova,
--     'and coalesce(public.fn_montar_payload_nfe(p_ref) ->> ''consumidor_final'', '''') <> ''1'' then',
--     'and coalesce(v_nf.consumidor_final, '''') <> ''1'' then');
--   execute v_nova;
-- end
-- $rollback$;
--
-- alter table public.enderecos drop column if exists ie_recebedor;
-- ============================================================================
