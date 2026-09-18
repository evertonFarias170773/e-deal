-- ============================================================================
-- Modalidade 9 (sem frete) nao leva o grupo do transportador
-- ============================================================================
--
-- O QUE MUDA
--   `fn_montar_payload_nfe` deixa de emitir as SETE chaves do grupo do
--   transportador quando `modalidade_frete` for 9:
--     nome_transportador, cnpj_transportador, cpf_transportador,
--     inscricao_estadual_transportador, endereco_transportador,
--     municipio_transportador, uf_transportador.
--   Nas demais modalidades o grupo sai exatamente como hoje.
--
-- POR QUE
--   Sefaz 845: "O Grupo Transportador nao pode ser preenchido para Modalidade
--   do frete informada". A regra vale para a modalidade 9 e SO para ela — a 9 e
--   "sem ocorrencia de transporte", entao nao pode haver transportador. Foi o
--   que derrubou a NFE-22347-001 em 18/09/2026.
--
--   E consequencia direta do cc489db (16/09), que renomeou as chaves para os
--   nomes que a Focus reconhece. Antes ela ignorava os campos e o grupo nunca
--   chegava ao XML; corrigidos os nomes, o grupo chega — e na modalidade 9 a
--   Sefaz o recusa.
--
-- O QUE NAO MUDA
--   As tres chaves internas do bloco — id_transportadora_cliente,
--   transportadora e transportadora_cep — continuam saindo em TODAS as
--   modalidades. Elas nao sao campos da Focus (o layout usaria
--   cep_transportador), nao viram XML e nao disparam a 845; quem le o payload
--   fora da emissao continua enxergando a transportadora escolhida.
--
--   Nenhuma nota existente e alterada: nao ha backfill, nao ha UPDATE.
--
-- METODO
--   Mesmo das anteriores: le a definicao VIVA com `pg_get_functiondef`, troca
--   com ancoras conferidas uma a uma, DESFAZ as trocas e exige que o texto
--   volte IDENTICO ao original — se alguma troca tivesse alcancado algo a mais,
--   a volta nao fecharia.
--
--   As trocas tem quebra de linha, entao as linhas novas sao montadas com
--   chr(13)||chr(10) e texto entre cifroes. NENHUMA E-string aqui: foi uma
--   E-string que engoliu o `\D` do regex na migration da remessa (82c5c8e) e
--   fez a funcao remover a letra D dos documentos.
--
-- A FORMA DA TROCA
--   O bloco da transportadora e um jsonb_build_object unico. Para tirar so as
--   sete chaves, ele vira DOIS: o primeiro com as tres internas, o segundo com
--   as sete, embrulhado num `case` que devolve '{}' na modalidade 9. A ordem
--   das chaves nao importa — jsonb normaliza —, por isso o payload das outras
--   modalidades sai byte a byte igual, e a assercao 1 exige isso.
--
-- A SONDAGEM DA ASSERCAO 4
--   A NFE-22347-001 ja foi corrigida a mao (esta na modalidade 3 e AUTORIZADA),
--   entao a sondagem a devolve para a modalidade 9 dentro de uma subtransacao
--   que e desfeita: variavel de PL/pgSQL sobrevive ao rollback, dado nao. A
--   assercao 5 confere que a nota continua na modalidade 3 depois disso.
-- ============================================================================

do $migracao$
declare
  v_crlf           text := chr(13) || chr(10);
  v_def            text;
  v_nova           text;
  v_volta          text;
  v_acl            text;
  v_secdef         boolean;
  v_config         text;
  v_acl_depois     text;
  v_secdef_depois  boolean;
  v_config_depois  text;
  v_hash_nao9      text;
  v_hash_nao9_dep  text;
  v_hash_9_espera  text;
  v_hash_9_depois  text;
  v_com_grupo      int;
  v_ocorrencias    int;
  v_pay            jsonb;
  v_modalidade     text;
  v_chaves         text[] := array[
    'nome_transportador', 'cnpj_transportador', 'cpf_transportador',
    'inscricao_estadual_transportador', 'endereco_transportador',
    'municipio_transportador', 'uf_transportador'
  ];
  de_a             text;
  para_a           text;
  de_b             text;
  para_b           text;
begin
  -- ==========================================================================
  -- 0. O ANTES
  -- ==========================================================================
  select md5(string_agg(x.ref || ':' || x.j::text, ',' order by x.ref))
    into v_hash_nao9
    from (select nf.ref,
                 public.fn_montar_payload_nfe(nf.ref) - 'data_emissao' - 'data_entrada_saida' as j
            from public.notas_fiscais nf
           where coalesce(btrim(nf.modalidade_frete), '') <> '9') x;

  -- O esperado da modalidade 9: o payload de hoje MENOS as sete chaves.
  select md5(string_agg(x.ref || ':' || x.j::text, ',' order by x.ref))
    into v_hash_9_espera
    from (select nf.ref,
                 ((((((public.fn_montar_payload_nfe(nf.ref)
                   - 'data_emissao' - 'data_entrada_saida'
                   - 'nome_transportador') - 'cnpj_transportador') - 'cpf_transportador')
                   - 'inscricao_estadual_transportador') - 'endereco_transportador')
                   - 'municipio_transportador') - 'uf_transportador' as j
            from public.notas_fiscais nf
           where coalesce(btrim(nf.modalidade_frete), '') = '9') x;

  select coalesce(array_to_string(p.proacl, ' | '), ''), p.prosecdef, coalesce(p.proconfig::text, '')
    into v_acl, v_secdef, v_config
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;

  -- ==========================================================================
  -- 1. As duas trocas
  -- ==========================================================================
  de_a :=
       $x$          ),$x$ || v_crlf
    || v_crlf
    || $x$        'nome_transportador',$x$;

  para_a :=
       $x$          ),$x$ || v_crlf
    || v_crlf
    || $x$        'transportadora_cep',$x$ || v_crlf
    || $x$          case$x$ || v_crlf
    || $x$            when nf.id_transportadora_cliente is not null$x$ || v_crlf
    || $x$              then nullif(regexp_replace(coalesce(et.cep, ''), '\D', '', 'g'), '')$x$ || v_crlf
    || $x$            else null$x$ || v_crlf
    || $x$          end$x$ || v_crlf
    || $x$      )$x$ || v_crlf
    || v_crlf
    || $x$      ||$x$ || v_crlf
    || v_crlf
    || $x$      -- =====================================================$x$ || v_crlf
    || $x$      -- Grupo do transportador$x$ || v_crlf
    || $x$      -- Na modalidade 9 (sem frete) a Sefaz PROIBE o grupo: rejeicao 845,$x$ || v_crlf
    || $x$      -- que derrubou a NFE-22347-001 em 18/09/2026. Ate 16/09 as chaves$x$ || v_crlf
    || $x$      -- tinham outro nome, a Focus as ignorava e nada chegava ao XML;$x$ || v_crlf
    || $x$      -- corrigidos os nomes (cc489db), o grupo passou a chegar.$x$ || v_crlf
    || $x$      -- Nas outras modalidades ele sai exatamente como antes.$x$ || v_crlf
    || $x$      -- =====================================================$x$ || v_crlf
    || $x$      case$x$ || v_crlf
    || $x$        when btrim(coalesce(nf.modalidade_frete, '')) = '9' then '{}'::jsonb$x$ || v_crlf
    || $x$        else jsonb_build_object($x$ || v_crlf
    || v_crlf
    || $x$        'nome_transportador',$x$;

  de_b :=
       $x$          end,$x$ || v_crlf
    || v_crlf
    || $x$        'transportadora_cep',$x$ || v_crlf
    || $x$          case$x$ || v_crlf
    || $x$            when nf.id_transportadora_cliente is not null$x$ || v_crlf
    || $x$              then nullif(regexp_replace(coalesce(et.cep, ''), '\D', '', 'g'), '')$x$ || v_crlf
    || $x$            else null$x$ || v_crlf
    || $x$          end$x$ || v_crlf
    || $x$      )$x$;

  para_b :=
       $x$          end$x$ || v_crlf
    || $x$      )$x$ || v_crlf
    || $x$      end$x$;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;

  v_ocorrencias := (length(v_def) - length(replace(v_def, de_a, ''))) / length(de_a);
  if v_ocorrencias <> 1 then
    raise exception 'a ancora do inicio do grupo aparece % vezes; esperava exatamente 1', v_ocorrencias;
  end if;
  v_ocorrencias := (length(v_def) - length(replace(v_def, de_b, ''))) / length(de_b);
  if v_ocorrencias <> 1 then
    raise exception 'a ancora do fim do grupo aparece % vezes; esperava exatamente 1', v_ocorrencias;
  end if;

  v_nova := replace(replace(v_def, de_a, para_a), de_b, para_b);

  -- A VOLTA: o texto tem de voltar IDENTICO.
  v_volta := replace(replace(v_nova, para_a, de_a), para_b, de_b);
  if v_volta is distinct from v_def then
    raise exception 'a troca alcancou algo alem do bloco da transportadora: o texto nao volta ao original';
  end if;

  execute v_nova;

  -- ==========================================================================
  -- 2. ASSERCOES
  -- ==========================================================================

  -- 2.1 O payload de toda nota FORA da modalidade 9 sai byte a byte igual.
  select md5(string_agg(x.ref || ':' || x.j::text, ',' order by x.ref))
    into v_hash_nao9_dep
    from (select nf.ref,
                 public.fn_montar_payload_nfe(nf.ref) - 'data_emissao' - 'data_entrada_saida' as j
            from public.notas_fiscais nf
           where coalesce(btrim(nf.modalidade_frete), '') <> '9') x;
  if v_hash_nao9_dep is distinct from v_hash_nao9 then
    raise exception 'assercao 1 falhou: mudou o payload de nota fora da modalidade 9 (antes %, depois %)',
      v_hash_nao9, v_hash_nao9_dep;
  end if;

  -- 2.2 Na modalidade 9, o payload e o de antes MENOS as sete chaves. Nada mais.
  select md5(string_agg(x.ref || ':' || x.j::text, ',' order by x.ref))
    into v_hash_9_depois
    from (select nf.ref,
                 public.fn_montar_payload_nfe(nf.ref) - 'data_emissao' - 'data_entrada_saida' as j
            from public.notas_fiscais nf
           where coalesce(btrim(nf.modalidade_frete), '') = '9') x;
  if v_hash_9_depois is distinct from v_hash_9_espera then
    raise exception 'assercao 2 falhou: na modalidade 9 mudou algo alem das sete chaves (esperado %, obtido %)',
      v_hash_9_espera, v_hash_9_depois;
  end if;

  -- 2.3 Nenhuma nota em modalidade 9 leva qualquer uma das sete chaves.
  select count(*) into v_com_grupo
    from public.notas_fiscais nf,
         lateral (select public.fn_montar_payload_nfe(nf.ref) as j) p,
         lateral unnest(v_chaves) as chave
   where coalesce(btrim(nf.modalidade_frete), '') = '9'
     and jsonb_exists(p.j, chave);
  if v_com_grupo <> 0 then
    raise exception 'assercao 3 falhou: % chaves do grupo sobraram em nota de modalidade 9', v_com_grupo;
  end if;

  -- 2.4 Nas outras modalidades o grupo continua chegando com conteudo.
  select count(*) into v_com_grupo
    from public.notas_fiscais nf,
         lateral (select public.fn_montar_payload_nfe(nf.ref) as j) p
   where coalesce(btrim(nf.modalidade_frete), '') <> '9'
     and p.j ->> 'nome_transportador' is not null;
  if v_com_grupo = 0 then
    raise exception 'assercao 4 falhou: nenhuma nota fora da modalidade 9 leva transportador';
  end if;

  -- 2.5 A NFE-22347-001, de volta para a modalidade 9 numa subtransacao desfeita.
  begin
    update public.notas_fiscais
       set modalidade_frete = '9',
           transportadora = 'TRANSPORTADORA DA SONDAGEM'
     where ref = 'NFE-22347-001';
    v_pay := public.fn_montar_payload_nfe('NFE-22347-001');
    raise exception '__desfazer__';
  exception when others then
    if sqlerrm <> '__desfazer__' then raise; end if;
  end;

  if v_pay is null then
    raise exception 'assercao 5 falhou: a sondagem nao montou payload para a NFE-22347-001';
  end if;
  if exists (select 1 from unnest(v_chaves) as chave where jsonb_exists(v_pay, chave)) then
    raise exception 'assercao 5 falhou: o grupo continua no payload da NFE-22347-001 em modalidade 9';
  end if;
  if coalesce(v_pay ->> 'transportadora', '') <> 'TRANSPORTADORA DA SONDAGEM' then
    raise exception 'assercao 5 falhou: a chave interna transportadora nao sobreviveu: %', v_pay ->> 'transportadora';
  end if;

  -- 2.6 A sondagem nao deixou rastro: a nota segue como estava.
  select coalesce(btrim(modalidade_frete), '') into v_modalidade
    from public.notas_fiscais where ref = 'NFE-22347-001';
  if v_modalidade <> '3' then
    raise exception 'assercao 6 falhou: a NFE-22347-001 ficou na modalidade % depois da sondagem', v_modalidade;
  end if;

  -- 2.7 ACL, SECURITY DEFINER e search_path intactos.
  select coalesce(array_to_string(p.proacl, ' | '), ''), p.prosecdef, coalesce(p.proconfig::text, '')
    into v_acl_depois, v_secdef_depois, v_config_depois
    from pg_proc p where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
  if v_acl_depois is distinct from v_acl then
    raise exception 'assercao 7 falhou: o ACL mudou (antes %, depois %)', v_acl, v_acl_depois;
  end if;
  if v_secdef_depois is distinct from v_secdef or v_config_depois is distinct from v_config then
    raise exception 'assercao 7 falhou: SECURITY DEFINER ou search_path mudaram (% / % -> % / %)',
      v_secdef, v_config, v_secdef_depois, v_config_depois;
  end if;

  raise notice 'ok: fora da 9 o payload nao mudou (%); na 9 saiu so o grupo (%)',
    v_hash_nao9_dep, v_hash_9_depois;
end
$migracao$;
