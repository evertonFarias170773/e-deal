-- NF-e: o destinatario da nota de REMESSA sai do endereco, nao do cliente
--
-- O QUE MUDA em public.fn_montar_payload_nfe(text)
--   1. Um join a mais: `left join public.enderecos er on er.id = nf.id_endereco_destinatario`.
--   2. Um bloco de SOBREPOSICAO no fim da montagem do payload:
--
--        case when upper(coalesce(nf.tipo_nota,'')) = 'REMESSA' and er.id is not null
--             then jsonb_build_object(... destinatario do endereco ...)
--             else '{}'::jsonb
--        end
--
--   Em jsonb, `a || b` faz a chave de `b` vencer a de `a`. Sendo o ultimo termo
--   da concatenacao, o bloco SOBREPOE nome, documento, IE, indicador de IE,
--   consumidor final, endereco do destinatario e local_destino — sem tocar em
--   NADA do que ja estava escrito acima. Nota que nao e remessa recebe `{}`, e
--   `x || '{}'::jsonb` devolve x: payload byte a byte igual ao de hoje.
--
-- POR QUE ASSIM, E NAO EDITANDO CADA CAMPO
--   Alterar as nove expressoes do destinatario uma a uma significaria nove
--   substituicoes no corpo de 17 mil caracteres, cada uma com chance propria de
--   errar e todas no caminho da nota de VENDA, que nao pode mudar. A sobreposicao
--   e UMA insercao, e o caminho da venda nao e tocado nem uma vez.
--
-- O QUE A REMESSA PASSA A MANDAR (so quando tipo_nota = 'REMESSA')
--   nome_destinatario                          enderecos.recebedor
--   cpf_destinatario                           enderecos.cpf_recebedor (so digitos)
--   cnpj_destinatario                          null
--   inscricao_estadual_destinatario            null
--   indicador_inscricao_estadual_destinatario  '9' (nao contribuinte)
--   consumidor_final                           '1'
--   logradouro/numero/complemento/bairro/      o proprio endereco apontado
--     municipio/uf/cep/pais _destinatario
--   local_destino                              UF da empresa x UF do endereco
--
--   Decidido com o contador e mantido: CFOP 5949/6949 e CSOSN 400 vem dos ITENS,
--   que esta migration nao toca; SEM grupo de partilha de ICMS da UF de destino
--   (Simples dispensado); SEM referencia a chave da nota de venda; sem texto
--   obrigatorio em informacoes complementares.
--
-- ENDERECO SEM RECEBEDOR OU SEM CPF
--   O bloco manda `null` nesses campos e a emissao FALHA ALTO na Focus/SEFAZ
--   (nome e CPF sao obrigatorios para destinatario pessoa fisica). E deliberado:
--   a alternativa — cair no cliente pagador — emitiria uma remessa no nome de
--   quem nao vai receber, em silencio. A guarda de verdade entra na etapa da
--   criacao da remessa, que vai exigir endereco com recebedor e CPF antes de
--   deixar a nota nascer. Medido em 15/09/2026: dos 38 enderecos com algum dos
--   dois campos, 2 tem recebedor sem CPF e 6 tem CPF sem recebedor.
--
-- ESCOPO / O QUE NAO MUDA
--   - o join com `clientes` e o endereco PRINCIPAL do cliente, do caminho da venda;
--   - itens, tributacao, duplicatas, formas de pagamento, pesos, volumes,
--     transportadora, emitente, informacoes adicionais e as mascaras de 10 casas;
--   - SECURITY DEFINER, `search_path=public` e o ACL (CREATE OR REPLACE preserva);
--   - as notas existentes: nenhum UPDATE, nenhum backfill.
--
--   Nesta etapa NENHUMA nota tem `tipo_nota` preenchido — as colunas nasceram
--   nulas na migration 20260915224455 e ninguem grava nelas ainda. Ou seja: hoje
--   o bloco novo nunca e acionado, e o payload de todas as notas continua igual.
--
-- COMO E FEITA
--   Mesmo metodo das duas anteriores: le `pg_get_functiondef`, faz UMA
--   substituicao e recria com CREATE OR REPLACE. Travas:
--     a) md5 do corpo igual ao lido ao escrever (a3c665d87a7d67d262e060cadb5e1505);
--     b) a ancora aparece uma unica vez;
--     c) desfazendo a substituicao no corpo novo, volta-se ao md5 original;
--     d) ACL identico antes e depois;
--     e) o bloco novo esta no corpo.
--   Qualquer falha aborta tudo.
--
-- ACL, REGISTRADO E NAO ALTERADO
--   {PUBLIC, anon, authenticated, postgres, service_role} com EXECUTE, como antes.
--   Esta migration nao concede nem revoga nada; o EXECUTE de anon/PUBLIC e
--   anterior e fica registrado para nao passar por resolvido.

do $migracao$
declare
  v_oid oid := 'public.fn_montar_payload_nfe(text)'::regprocedure;
  v_def text;
  v_md5_antes text;
  v_acl_antes text;
  v_md5_depois text;
  v_prosrc_depois text;
  v_acl_depois text;
  v_crlf text := chr(13) || chr(10);
  v_ancora text;
  v_novo text;
  v_ocorrencias integer;
begin
  v_ancora := array_to_string(ARRAY[
    $l$      )$l$,
    $l$    )$l$,
    $l$  into v_payload$l$,
    $l$  from public.notas_fiscais nf$l$
  ], v_crlf);

  v_novo := array_to_string(ARRAY[
    $l$      )$l$,
    $l$$l$,
    $l$      ||$l$,
    $l$$l$,
    $l$      -- =====================================================$l$,
    $l$      -- Destinatario da REMESSA (15/09/2026)$l$,
    $l$      -- =====================================================$l$,
    $l$      -- A nota de remessa vai para quem RECEBE: pessoa fisica, sem cadastro$l$,
    $l$      -- em `clientes`. Nome, CPF e endereco saem de `enderecos`, pela coluna$l$,
    $l$      -- `nf.id_endereco_destinatario`. Este bloco e o ULTIMO termo da$l$,
    $l$      -- concatenacao de proposito: em jsonb a chave da direita vence, entao$l$,
    $l$      -- ele SOBREPOE o destinatario montado acima sem alterar aquele codigo.$l$,
    $l$      -- Nota que nao e remessa recebe {} e sai exatamente como antes.$l$,
    $l$      case$l$,
    $l$        when upper(coalesce(nf.tipo_nota, '')) = 'REMESSA' and er.id is not null then$l$,
    $l$          jsonb_build_object($l$,
    $l$            'nome_destinatario', nullif(btrim(er.recebedor), ''),$l$,
    $l$            'cnpj_destinatario', null,$l$,
    $l$            'cpf_destinatario', nullif(regexp_replace(coalesce(er.cpf_recebedor, ''), '\D', '', 'g'), ''),$l$,
    $l$            'inscricao_estadual_destinatario', null,$l$,
    $l$            'indicador_inscricao_estadual_destinatario', '9',$l$,
    $l$            'consumidor_final', '1',$l$,
    $l$            'logradouro_destinatario', er.endereco,$l$,
    $l$            'numero_destinatario', er.numero,$l$,
    $l$            'complemento_destinatario', nullif(er.complemento, ''),$l$,
    $l$            'bairro_destinatario', er.bairro,$l$,
    $l$            'municipio_destinatario', er.cidade,$l$,
    $l$            'uf_destinatario', er.uf,$l$,
    $l$            'cep_destinatario', regexp_replace(coalesce(er.cep, ''), '\D', '', 'g'),$l$,
    $l$            'pais_destinatario', 'Brasil',$l$,
    $l$            'local_destino',$l$,
    $l$              case$l$,
    $l$                when upper(coalesce(emp.uf, '')) = upper(coalesce(er.uf, '')) then '1'$l$,
    $l$                else '2'$l$,
    $l$              end$l$,
    $l$          )$l$,
    $l$        else '{}'::jsonb$l$,
    $l$      end$l$,
    $l$    )$l$,
    $l$  into v_payload$l$,
    $l$  from public.notas_fiscais nf$l$,
    $l$$l$,
    $l$  -- Endereco do destinatario da REMESSA. Null na nota de venda, e ai o bloco$l$,
    $l$  -- acima nao e acionado.$l$,
    $l$  left join public.enderecos er$l$,
    $l$    on er.id = nf.id_endereco_destinatario$l$
  ], v_crlf);

  select pg_get_functiondef(p.oid), md5(p.prosrc),
         (select array_agg(coalesce(r.rolname, 'PUBLIC') order by coalesce(r.rolname, 'PUBLIC'))::text
            from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee)
    into v_def, v_md5_antes, v_acl_antes
    from pg_proc p where p.oid = v_oid;

  -- (a)
  if v_md5_antes <> 'a3c665d87a7d67d262e060cadb5e1505' then
    raise exception 'fn_montar_payload_nfe mudou desde que esta migration foi escrita (md5 %). Abortado.', v_md5_antes;
  end if;

  -- (b)
  v_ocorrencias := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  if v_ocorrencias <> 1 then
    raise exception 'Ancora do fim da montagem aparece % vezes (esperado 1). Abortado.', v_ocorrencias;
  end if;

  execute replace(v_def, v_ancora, v_novo);

  select p.prosrc, md5(p.prosrc),
         (select array_agg(coalesce(r.rolname, 'PUBLIC') order by coalesce(r.rolname, 'PUBLIC'))::text
            from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee)
    into v_prosrc_depois, v_md5_depois, v_acl_depois
    from pg_proc p where p.oid = v_oid;

  -- (c)
  if md5(replace(v_prosrc_depois, v_novo, v_ancora)) <> v_md5_antes then
    raise exception 'O corpo novo difere do antigo alem do bloco da remessa. Abortado.';
  end if;

  -- (d)
  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'ACL mudou: % -> %. Abortado.', v_acl_antes, v_acl_depois;
  end if;

  -- (e)
  if position('Destinatario da REMESSA' in v_prosrc_depois) = 0 then
    raise exception 'Bloco da remessa nao encontrado no corpo. Abortado.';
  end if;

  raise notice 'fn_montar_payload_nfe: md5 % -> %, ACL %', v_md5_antes, v_md5_depois, v_acl_depois;
end
$migracao$;

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) assinatura, SECURITY DEFINER, search_path e ACL
--   select p.oid::regprocedure, p.prosecdef, p.proconfig,
--          (select array_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC'))
--             from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee) grantees
--     from pg_proc p where p.proname = 'fn_montar_payload_nfe';
--   -- esperado: fn_montar_payload_nfe(text), true, {search_path=public},
--   --           {PUBLIC,anon,authenticated,postgres,service_role}
--
--   -- b) o payload de TODAS as notas existentes, uma a uma, com hash agregado
--   with p as (
--     select n.ref, md5((public.fn_montar_payload_nfe(n.ref) - 'data_emissao' - 'data_entrada_saida')::text) h
--       from public.notas_fiscais n where n.created_at < '2026-09-15 22:50:00+00'
--   )
--   select count(*), md5(string_agg(ref || ':' || h, ',' order by ref)) from p;
--   -- esperado: 44 e d0057de6653b8cc41339f59ee1b9453b (o mesmo de antes)
--
--   -- c) nenhuma nota alterada
--   select count(*), count(tipo_nota), count(id_endereco_destinatario), max(updated_at)
--     from public.notas_fiscais;
--   -- esperado: tipo_nota e id_endereco_destinatario em ZERO; max(updated_at) inalterado
--
--   -- d) simulacao da remessa, SEM GRAVAR: marca-se a nota dentro de uma
--   --    transacao que termina em rollback.
--   begin;
--     update public.notas_fiscais
--        set tipo_nota = 'REMESSA',
--            id_endereco_destinatario = (
--              select e.id from public.enderecos e
--               where nullif(btrim(e.recebedor), '') is not null
--                 and length(regexp_replace(coalesce(e.cpf_recebedor,''), '\D', '', 'g')) = 11
--               limit 1)
--      where ref = 'NFE-22066-004';
--     select public.fn_montar_payload_nfe('NFE-22066-004') -> 'nome_destinatario';
--   rollback;
--   -- esperado: o recebedor do endereco, e a nota volta intacta pelo rollback.
--
-- ROLLBACK
--   Recria a funcao sem o bloco, pelo mesmo mecanismo: ler a definicao, trocar
--   o bloco da remessa pela ancora original e executar. Depois, md5(prosrc) volta
--   a a3c665d87a7d67d262e060cadb5e1505. O join `er` sai junto, porque faz parte
--   do mesmo trecho substituido.
