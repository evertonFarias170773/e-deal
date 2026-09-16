-- ============================================================================
-- fn_montar_payload_nfe: os nomes da transportadora que a Focus reconhece
-- ============================================================================
--
-- O PROBLEMA
--   O payload saía com `transportadora_nome`, `transportadora_cnpj` e companhia.
--   A Focus espera o SUFIXO `_transportador`: `nome_transportador`,
--   `cnpj_transportador`, `endereco_transportador`... Campo que ela não conhece
--   é ignorado em silêncio, então a nota era autorizada normalmente e saía sem o
--   grupo <transporta> no XML — e sem transportadora na DANFE.
--
--   A prova está no XML autorizado de três notas com transportadoras diferentes
--   (NFE-22192-001, NFE-21409-001, NFE-21956-001): todas trazem
--   <transp><modFrete>0</modFrete><vol>...</vol></transp> e NENHUMA traz
--   <transporta>. `modalidade_frete` e os volumes chegavam porque esses nomes já
--   estavam certos.
--
--   Nada se perdia no n8n: o nó de emissão manda `{{ $json.payload }}`, o objeto
--   inteiro, sem escolher campos.
--
-- O QUE MUDA
--   SÓ O NOME de sete chaves. Os valores, os CASE e os JOIN com
--   `clientes`/`enderecos` ficam exatamente como estavam.
--
--   Ficam onde estão, de propósito: `transportadora` (texto simples),
--   `transportadora_cep` (o grupo transporta da NF-e 4.00 não tem CEP) e
--   `id_transportadora_cliente` (nosso). A Focus ignora os três hoje e
--   continuará ignorando; o preview técnico e telas nossas podem lê-los.
--
-- SOBRE AS NOTAS JÁ AUTORIZADAS
--   O payload delas passa a sair com os nomes novos, e isso não tem efeito
--   prático: o XML já foi assinado e está na Sefaz, e a RPC só seria chamada de
--   novo num reenvio, que a trava de duplicidade impede. Nenhuma linha de
--   `notas_fiscais` é tocada — não há backfill aqui.
--
-- MÉTODO
--   A função tem centenas de linhas. Transcrevê-la para mudar sete palavras
--   seria reescrever tudo o que ela sabe, com a chance de errar em silêncio.
--   Então: lê a definição viva com `pg_get_functiondef`, troca as sete chaves,
--   DESFAZ a troca e exige que o texto volte a ser IDÊNTICO ao original — se
--   alguma troca tivesse pegado algo a mais, esta volta não fecharia. Só então
--   recria com CREATE OR REPLACE, que preserva dono, ACL e comentário.
-- ============================================================================

do $migracao$
declare
  fonte            text;
  nova             text;
  volta            text;
  acl_antes        text;
  secdef_antes     boolean;
  config_antes     text;
  antigos          text[] := array[
                      'transportadora_nome',
                      'transportadora_cnpj',
                      'transportadora_cpf',
                      'transportadora_ie',
                      'transportadora_endereco',
                      'transportadora_municipio',
                      'transportadora_uf'
                    ];
  novos            text[] := array[
                      'nome_transportador',
                      'cnpj_transportador',
                      'cpf_transportador',
                      'inscricao_estadual_transportador',
                      'endereco_transportador',
                      'municipio_transportador',
                      'uf_transportador'
                    ];
  i                int;
  ocorrencias      int;
begin
  select pg_get_functiondef(p.oid),
         coalesce(array_to_string(p.proacl, ' | '), ''),
         p.prosecdef,
         coalesce(p.proconfig::text, '')
    into fonte, acl_antes, secdef_antes, config_antes
    from pg_proc p
   where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;

  if fonte is null then
    raise exception 'fn_montar_payload_nfe(text) nao encontrada';
  end if;

  -- 1. Cada chave antiga tem de aparecer UMA vez, como literal entre aspas.
  nova := fonte;
  for i in 1 .. array_length(antigos, 1) loop
    select count(*) into ocorrencias
      from regexp_matches(nova, '''' || antigos[i] || '''', 'g');
    if ocorrencias <> 1 then
      raise exception 'a chave % aparece % vezes na fonte; esperava exatamente 1',
        antigos[i], ocorrencias;
    end if;
    nova := replace(nova, '''' || antigos[i] || '''', '''' || novos[i] || '''');
  end loop;

  -- 2. A volta: desfazendo as sete trocas, o texto tem de ser o original.
  --    Se alguma troca tivesse alcancado algo alem da chave, isto nao fecharia.
  volta := nova;
  for i in 1 .. array_length(antigos, 1) loop
    volta := replace(volta, '''' || novos[i] || '''', '''' || antigos[i] || '''');
  end loop;
  if volta is distinct from fonte then
    raise exception 'a troca alcancou algo alem das sete chaves: o texto nao volta ao original';
  end if;

  -- 3. O que NAO pode ser tocado continua inteiro.
  for i in 1 .. 3 loop
    select count(*) into ocorrencias
      from regexp_matches(nova, '''' || (array['transportadora', 'transportadora_cep', 'id_transportadora_cliente'])[i] || '''', 'g');
    if ocorrencias <> 1 then
      raise exception 'a chave preservada % aparece % vezes; esperava 1',
        (array['transportadora', 'transportadora_cep', 'id_transportadora_cliente'])[i], ocorrencias;
    end if;
  end loop;

  execute nova;

  -- 4. Depois: as novas presentes, as antigas ausentes.
  for i in 1 .. array_length(novos, 1) loop
    select count(*) into ocorrencias
      from pg_proc p, regexp_matches(p.prosrc, '''' || novos[i] || '''', 'g')
     where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
    if ocorrencias <> 1 then
      raise exception 'apos recriar, % aparece % vezes; esperava 1', novos[i], ocorrencias;
    end if;

    select count(*) into ocorrencias
      from pg_proc p, regexp_matches(p.prosrc, '''' || antigos[i] || '''', 'g')
     where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure;
    if ocorrencias <> 0 then
      raise exception 'apos recriar, a chave antiga % ainda aparece % vezes', antigos[i], ocorrencias;
    end if;
  end loop;

  -- 5. ACL, SECURITY DEFINER e search_path intactos.
  perform 1
     from pg_proc p
    where p.oid = 'public.fn_montar_payload_nfe(text)'::regprocedure
      and coalesce(array_to_string(p.proacl, ' | '), '') = acl_antes
      and p.prosecdef = secdef_antes
      and coalesce(p.proconfig::text, '') = config_antes;
  if not found then
    raise exception 'ACL, SECURITY DEFINER ou search_path mudaram na recriacao';
  end if;

  raise notice 'fn_montar_payload_nfe: sete chaves da transportadora renomeadas para o padrao da Focus';
end
$migracao$;
