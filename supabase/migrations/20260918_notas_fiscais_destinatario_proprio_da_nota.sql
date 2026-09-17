-- ============================================================================
-- Destinatario proprio da NOTA: nome e endereco que valem so para ela
-- ============================================================================
--
-- O QUE MUDA
--   1. Cinco colunas em `notas_fiscais`, todas `text` e nulas:
--      dest_nome, dest_logradouro, dest_numero, dest_complemento, dest_bairro.
--   2. `fn_montar_payload_nfe` passa a ler essas colunas ANTES do cadastro, nos
--      DOIS blocos de destinatario: o base (venda) e o de REMESSA.
--
-- POR QUE
--   O layout da NF-e corta em 60 caracteres e a conferencia do 90bf3c7 barra a
--   emissao. Sem isto, a unica saida e editar o cadastro do cliente — que muda o
--   nome dele na proposta, na etiqueta e na cobranca. Agora a NOTA leva a versao
--   curta e o cadastro fica inteiro.
--
--   Nula ou so espacos = usa o cadastro, exatamente como hoje. Nenhuma nota
--   existente muda de payload: nenhuma tem sobrescrita.
--
--   MUNICIPIO, UF e CEP ficam de FORA de proposito: a UF decide o CFOP e o
--   `local_destino`, o municipio precisa casar com o nome oficial, e nenhum dos
--   tres tem estouro de tamanho hoje.
--
-- METODO
--   A funcao tem 20 mil caracteres. Transcreve-la para mudar dez linhas seria
--   reescrever o que ela sabe. Entao: le a definicao VIVA com
--   `pg_get_functiondef`, troca as dez linhas com ancoras conferidas uma a uma,
--   DESFAZ as trocas e exige que o texto volte IDENTICO ao original — se alguma
--   troca tivesse alcancado algo a mais, a volta nao fecharia.
--
--   As dez trocas sao de UMA LINHA, sem quebra e sem barra invertida, entao nao
--   ha E-string nenhuma aqui. Foi uma E-string que engoliu o `\D` do regex na
--   migration da remessa (82c5c8e) e fez a funcao remover a letra D.
--
-- A SONDAGEM DA ASSERCAO 3
--   Nao existe nota de REMESSA no banco hoje — a ultima foi descartada. Entao a
--   sondagem TRANSFORMA uma nota de venda em remessa dentro de uma subtransacao
--   que e desfeita: variavel de PL/pgSQL sobrevive ao rollback, dado nao. Ao fim
--   do bloco nenhuma linha de `notas_fiscais` esta diferente.
-- ============================================================================

do $migracao$
declare
  v_def            text;
  v_nova           text;
  v_volta          text;
  v_acl            text;
  v_secdef         boolean;
  v_config         text;
  v_hash_antes     text;
  v_hash_depois    text;
  v_ref_venda      text;
  v_ref_remessa    text;
  v_id_endereco    uuid;
  v_pay            jsonb;
  v_ocorrencias    int;
  i                int;
  antigos          text[] := array[
    '''nome_destinatario'', c.nome,',
    '''logradouro_destinatario'', e.endereco,',
    '''numero_destinatario'', e.numero,',
    '''complemento_destinatario'', nullif(e.complemento, ''''),',
    '''bairro_destinatario'', e.bairro,',
    '''nome_destinatario'', nullif(btrim(er.recebedor), ''''),',
    '''logradouro_destinatario'', er.endereco,',
    '''numero_destinatario'', er.numero,',
    '''complemento_destinatario'', nullif(er.complemento, ''''),',
    '''bairro_destinatario'', er.bairro,'
  ];
  novos            text[] := array[
    '''nome_destinatario'', coalesce(nullif(btrim(nf.dest_nome), ''''), c.nome),',
    '''logradouro_destinatario'', coalesce(nullif(btrim(nf.dest_logradouro), ''''), e.endereco),',
    '''numero_destinatario'', coalesce(nullif(btrim(nf.dest_numero), ''''), e.numero),',
    '''complemento_destinatario'', coalesce(nullif(btrim(nf.dest_complemento), ''''), nullif(e.complemento, '''')),',
    '''bairro_destinatario'', coalesce(nullif(btrim(nf.dest_bairro), ''''), e.bairro),',
    '''nome_destinatario'', coalesce(nullif(btrim(nf.dest_nome), ''''), nullif(btrim(er.recebedor), '''')),',
    '''logradouro_destinatario'', coalesce(nullif(btrim(nf.dest_logradouro), ''''), er.endereco),',
    '''numero_destinatario'', coalesce(nullif(btrim(nf.dest_numero), ''''), er.numero),',
    '''complemento_destinatario'', coalesce(nullif(btrim(nf.dest_complemento), ''''), nullif(er.complemento, '''')),',
    '''bairro_destinatario'', coalesce(nullif(btrim(nf.dest_bairro), ''''), er.bairro),'
  ];
begin
  -- ==========================================================================
  -- 0. O ANTES
  -- ==========================================================================
  select md5(string_agg(x.ref || ':' || (x.j - 'data_emissao' - 'data_entrada_saida')::text, ',' order by x.ref))
    into v_hash_antes
    from (select nf.ref, public.fn_montar_payload_nfe(nf.ref) as j from public.notas_fiscais nf) x;

  select coalesce(array_to_string(p.proacl, ' | '), ''), p.prosecdef, coalesce(p.proconfig::text, '')
    into v_acl, v_secdef, v_config
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;

  -- ==========================================================================
  -- 1. As cinco colunas
  -- ==========================================================================
  alter table public.notas_fiscais add column if not exists dest_nome        text;
  alter table public.notas_fiscais add column if not exists dest_logradouro  text;
  alter table public.notas_fiscais add column if not exists dest_numero      text;
  alter table public.notas_fiscais add column if not exists dest_complemento text;
  alter table public.notas_fiscais add column if not exists dest_bairro      text;

  comment on column public.notas_fiscais.dest_nome is
    'Nome do destinatario SO NESTA NOTA. Nulo ou so espacos = usa clientes.nome (venda) ou enderecos.recebedor (remessa). Existe para caber nos 60 caracteres do layout da NF-e sem alterar o cadastro, que segue completo na proposta, na etiqueta e na cobranca. Criada em 18/09/2026.';
  comment on column public.notas_fiscais.dest_logradouro is
    'Logradouro do destinatario SO NESTA NOTA. Nulo ou so espacos = usa enderecos.endereco. Mesma razao do dest_nome.';
  comment on column public.notas_fiscais.dest_numero is
    'Numero do endereco do destinatario SO NESTA NOTA. Nulo ou so espacos = usa enderecos.numero.';
  comment on column public.notas_fiscais.dest_complemento is
    'Complemento do destinatario SO NESTA NOTA. Nulo ou so espacos = usa enderecos.complemento.';
  comment on column public.notas_fiscais.dest_bairro is
    'Bairro do destinatario SO NESTA NOTA. Nulo ou so espacos = usa enderecos.bairro.';

  -- ==========================================================================
  -- 2. A funcao: as dez linhas
  -- ==========================================================================
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;

  v_nova := v_def;
  for i in 1 .. array_length(antigos, 1) loop
    v_ocorrencias := (length(v_nova) - length(replace(v_nova, antigos[i], ''))) / length(antigos[i]);
    if v_ocorrencias <> 1 then
      raise exception 'ancora % aparece % vezes; esperava exatamente 1', antigos[i], v_ocorrencias;
    end if;
    v_nova := replace(v_nova, antigos[i], novos[i]);
  end loop;

  -- A VOLTA
  v_volta := v_nova;
  for i in 1 .. array_length(novos, 1) loop
    v_volta := replace(v_volta, novos[i], antigos[i]);
  end loop;
  if v_volta is distinct from v_def then
    raise exception 'a troca alcancou algo alem das dez linhas: o texto nao volta ao original';
  end if;

  execute v_nova;

  -- ==========================================================================
  -- 3. ASSERCOES
  -- ==========================================================================

  -- 3.1 O payload de TODA nota de hoje sai identico.
  select md5(string_agg(x.ref || ':' || (x.j - 'data_emissao' - 'data_entrada_saida')::text, ',' order by x.ref))
    into v_hash_depois
    from (select nf.ref, public.fn_montar_payload_nfe(nf.ref) as j from public.notas_fiscais nf) x;
  if v_hash_depois is distinct from v_hash_antes then
    raise exception 'assercao 1 falhou: o payload de alguma nota mudou (antes %, depois %)',
      v_hash_antes, v_hash_depois;
  end if;

  -- 3.2 Nota de VENDA com dest_nome preenchido usa a versao da nota.
  select nf.ref into v_ref_venda
    from public.notas_fiscais nf
   where coalesce(nf.tipo_nota, '') = ''
     and nf.status not in ('AUTORIZADA', 'CANCELADA')
   order by nf.ref limit 1;
  if v_ref_venda is null then
    raise exception 'nao ha nota de venda em processo para a sondagem da assercao 2';
  end if;

  begin
    update public.notas_fiscais
       set dest_nome = 'NOME CURTO DA NOTA',
           dest_logradouro = 'RUA CURTA DA NOTA',
           dest_numero = '99',
           dest_complemento = 'COMPL DA NOTA',
           dest_bairro = 'BAIRRO DA NOTA'
     where ref = v_ref_venda;
    v_pay := public.fn_montar_payload_nfe(v_ref_venda);
    raise exception '__desfazer__';
  exception when others then
    if sqlerrm <> '__desfazer__' then raise; end if;
  end;

  if coalesce(v_pay ->> 'nome_destinatario', '') <> 'NOME CURTO DA NOTA'
     or coalesce(v_pay ->> 'logradouro_destinatario', '') <> 'RUA CURTA DA NOTA'
     or coalesce(v_pay ->> 'numero_destinatario', '') <> '99'
     or coalesce(v_pay ->> 'complemento_destinatario', '') <> 'COMPL DA NOTA'
     or coalesce(v_pay ->> 'bairro_destinatario', '') <> 'BAIRRO DA NOTA' then
    raise exception 'assercao 2 falhou: a sobrescrita nao chegou ao payload da venda: %', v_pay;
  end if;

  -- 3.3 O ramo de REMESSA tambem le. Nao ha nota de remessa hoje, entao a
  --     sondagem cria uma DENTRO da subtransacao desfeita.
  select e.id into v_id_endereco
    from public.notas_fiscais nf
    join public.enderecos e on e.id_cliente = nf.id_cliente::integer
   where nf.ref = v_ref_venda
   order by e.data_criacao limit 1;
  if v_id_endereco is null then
    raise exception 'a nota da sondagem nao tem endereco de cliente para virar remessa';
  end if;

  begin
    update public.notas_fiscais
       set tipo_nota = 'REMESSA',
           id_endereco_destinatario = v_id_endereco,
           dest_nome = 'RECEBEDOR CURTO DA NOTA',
           dest_bairro = 'BAIRRO REMESSA DA NOTA'
     where ref = v_ref_venda;
    v_pay := public.fn_montar_payload_nfe(v_ref_venda);
    v_ref_remessa := v_ref_venda;
    raise exception '__desfazer__';
  exception when others then
    if sqlerrm <> '__desfazer__' then raise; end if;
  end;

  if coalesce(v_pay ->> 'nome_destinatario', '') <> 'RECEBEDOR CURTO DA NOTA'
     or coalesce(v_pay ->> 'bairro_destinatario', '') <> 'BAIRRO REMESSA DA NOTA' then
    raise exception 'assercao 3 falhou: o ramo de REMESSA nao leu a sobrescrita: %', v_pay;
  end if;

  -- 3.4 ACL, SECURITY DEFINER e search_path intactos.
  perform 1 from pg_proc p
   where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure
     and coalesce(array_to_string(p.proacl, ' | '), '') = v_acl
     and p.prosecdef = v_secdef
     and coalesce(p.proconfig::text, '') = v_config;
  if not found then
    raise exception 'assercao 4 falhou: ACL, SECURITY DEFINER ou search_path mudaram';
  end if;

  -- 3.5 As sondagens nao deixaram rastro.
  if exists (
    select 1 from public.notas_fiscais
     where dest_nome is not null or dest_logradouro is not null or dest_numero is not null
        or dest_complemento is not null or dest_bairro is not null
  ) then
    raise exception 'assercao 5 falhou: alguma nota ficou com sobrescrita gravada';
  end if;

  raise notice 'destinatario proprio da nota: cinco colunas criadas e lidas nos dois blocos; sondagens em % e %', v_ref_venda, v_ref_remessa;
end
$migracao$;

-- ============================================================================
-- ROLLBACK (comentado — rode a mao se precisar desfazer)
-- ============================================================================
-- do $rollback$
-- declare
--   v_def text; v_nova text; i int;
--   antigos text[] := array[
--     '''nome_destinatario'', coalesce(nullif(btrim(nf.dest_nome), ''''), c.nome),',
--     '''logradouro_destinatario'', coalesce(nullif(btrim(nf.dest_logradouro), ''''), e.endereco),',
--     '''numero_destinatario'', coalesce(nullif(btrim(nf.dest_numero), ''''), e.numero),',
--     '''complemento_destinatario'', coalesce(nullif(btrim(nf.dest_complemento), ''''), nullif(e.complemento, '''')),',
--     '''bairro_destinatario'', coalesce(nullif(btrim(nf.dest_bairro), ''''), e.bairro),',
--     '''nome_destinatario'', coalesce(nullif(btrim(nf.dest_nome), ''''), nullif(btrim(er.recebedor), '''')),',
--     '''logradouro_destinatario'', coalesce(nullif(btrim(nf.dest_logradouro), ''''), er.endereco),',
--     '''numero_destinatario'', coalesce(nullif(btrim(nf.dest_numero), ''''), er.numero),',
--     '''complemento_destinatario'', coalesce(nullif(btrim(nf.dest_complemento), ''''), nullif(er.complemento, '''')),',
--     '''bairro_destinatario'', coalesce(nullif(btrim(nf.dest_bairro), ''''), er.bairro),'
--   ];
--   novos text[] := array[
--     '''nome_destinatario'', c.nome,',
--     '''logradouro_destinatario'', e.endereco,',
--     '''numero_destinatario'', e.numero,',
--     '''complemento_destinatario'', nullif(e.complemento, ''''),',
--     '''bairro_destinatario'', e.bairro,',
--     '''nome_destinatario'', nullif(btrim(er.recebedor), ''''),',
--     '''logradouro_destinatario'', er.endereco,',
--     '''numero_destinatario'', er.numero,',
--     '''complemento_destinatario'', nullif(er.complemento, ''''),',
--     '''bairro_destinatario'', er.bairro,'
--   ];
-- begin
--   select pg_get_functiondef(oid) into v_def
--     from pg_proc where oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
--   v_nova := v_def;
--   for i in 1 .. array_length(antigos, 1) loop
--     v_nova := replace(v_nova, antigos[i], novos[i]);
--   end loop;
--   execute v_nova;
-- end
-- $rollback$;
--
-- As colunas so devem cair se ninguem tiver preenchido nada nelas:
-- alter table public.notas_fiscais drop column if exists dest_nome;
-- alter table public.notas_fiscais drop column if exists dest_logradouro;
-- alter table public.notas_fiscais drop column if exists dest_numero;
-- alter table public.notas_fiscais drop column if exists dest_complemento;
-- alter table public.notas_fiscais drop column if exists dest_bairro;
-- ============================================================================
