-- Payload da NF-e: o endereco volta a ser o PRINCIPAL — agora o do PAGADOR
--
-- O QUE E
--   Troca UM bloco de join dentro de `public.fn_montar_payload_nfe`. Nada mais
--   da funcao muda, e a definicao e lida VIVA do banco com pg_get_functiondef —
--   nao ha corpo transcrito aqui que possa divergir do que esta rodando.
--
--   Antes (aplicado em 22/08/2026, migration ..._endereco_do_pedido):
--     o endereco saia de `propostas.id_endereco_ent`, com o principal do cliente
--     como reserva.
--   Depois:
--     o endereco sai do PRINCIPAL de `nf.id_cliente`, com desempate deterministico.
--
-- POR QUE
--   Etapa C (no aplicativo, mesma rodada) passa a gravar `notas_fiscais.id_cliente`
--   com o PAGADOR — `propostas.id_faturado` quando difere de `id_cliente`. O
--   documento fiscal sai sempre no nome de quem paga: o cliente da proposta e
--   quem encomenda e, em parte dos casos, e um agenciador com procuracao para
--   comprar em nome de outra empresa.
--
--   Com o destinatario mudando, o endereco tem de mudar junto. Manter o
--   `id_endereco_ent` deixaria a nota com o NOME do pagador e o ENDERECO do
--   agenciador — pior do que hoje, e a rejeicao 732 de volta.
--
--   Por isso as duas metades andam juntas: esta migration sem a Etapa C, ou a
--   Etapa C sem esta migration, produzem nota incoerente.
--
-- O DESEMPATE, E POR QUE ELE EXISTE
--   "Principal e unico por cliente" NAO se sustenta em producao. Levantado em
--   22/08/2026: 8 cadastros tem dois enderecos marcados principal, e 5 deles sao
--   pagadores da fila de faturamento. Cada par tem um `Principal` (base antiga) e
--   um `PRINCIPAL` (importacao da Receita Federal), em CIDADES E UFS DIFERENTES:
--
--     GRUPO TERRITORIO   Principal Natal/RN        PRINCIPAL Itabuna/BA
--     FX MIDIA           Principal Bom Sucesso/MG  PRINCIPAL Novo Hamburgo/RS
--     INGRESSOPRINT      Principal Brasilia/DF     PRINCIPAL Porto Alegre/RS
--     IMPRIMIX           Principal Xangri-La/RS    PRINCIPAL Goiania/GO
--     STUDIO IAN         (duas linhas, ambas Santarem/PA)
--
--   O `order by ep.id` anterior ordena por UUID: sorteava. E a UF sorteada
--   decide o CFOP (5101 interno x 6101 interestadual) e o `local_destino`. Em 4
--   dos 5 casos o sorteio dava o endereco errado — no IMPRIMIX daria Xangri-La/RS
--   quando o real e Goiania/GO, confirmado pelo dono.
--
--   A regra nova, na ordem:
--     1. grafia em CAIXA ALTA `PRINCIPAL` vence — e o endereco oficial do CNPJ;
--     2. empate: o mais recente por `data_criacao`;
--     3. ultimo criterio, so para nunca ser nao-deterministico: o `id`.
--
--   O MESMO criterio vive em `resolverEnderecoPrincipal`
--   (src/features/nfe/services/nfe.service.ts), que decide o CFOP no rascunho.
--   Se um mudar, o outro TEM de mudar junto: e a mesma pergunta feita em dois
--   lugares, e discordar entre eles e exatamente a incoerencia que a nota rejeita.
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   NAO altera nem apaga endereco: os 8 cadastros com principal duplicado ficam
--   como estao. So a LEITURA muda.
--   NAO reescreve nota nenhuma. Nao ha UPDATE, DELETE nem backfill.
--   NAO recalcula CFOP de rascunho existente.
--   NAO toca o join da transportadora, o de itens, o de empresa nem qualquer
--   outro trecho: a substituicao e de um bloco literal so, com guardas.
--
--   Verificado no banco em 22/08/2026, ANTES de escrever:
--
--   1. As 3 notas AUTORIZADAS nao mudam de resolucao. Simuladas uma a uma, o
--      endereco resolvido pela regra nova e IDENTICO ao de hoje:
--        NFE-20370-003  Santa Cruz Do Sul/RS -> Santa Cruz Do Sul/RS
--        NFE-20916-001  Porto Alegre/RS      -> Porto Alegre/RS
--        NFE-20925-001  Toledo/PR            -> Toledo/PR
--
--   2. Na fila (17 pedidos com libera_nf), 3 mudam de UF de destino, e os tres
--      sao do mesmo cliente-agenciador com pagadores distintos:
--        #21078  Garanhuns/PE -> Itabuna/BA   CFOP 6101 -> 6101
--        #21074  Garanhuns/PE -> Goiania/GO   CFOP 6101 -> 6101
--        #20943  Garanhuns/PE -> Itabuna/BA   CFOP 6101 -> 6101
--      Nenhum troca de classe de CFOP: todos seguem interestaduais.
--      Os outros 14 nao mudam nada.
--
--   3. Nenhum pagador da fila esta sem endereco principal.
--
--   4. UM cadastro tinha dois `PRINCIPAL` em caixa alta: AUTOMATECH (66235),
--      Porto Alegre/RS e Extrema/MG, criados com uma hora de diferenca no mesmo
--      dia. Cairia no criterio 2 e ficaria com Porto Alegre/RS, o mais recente.
--
--      ATUALIZADO EM 23/08/2026, ANTES DE APLICAR: o cadastro foi higienizado
--      pelo dono e agora existe o indice unico
--      `enderecos_um_principal_por_cliente`, sobre `tipo_endereco = 'PRINCIPAL'`.
--      Medido no momento da aplicacao: ZERO clientes com mais de um endereco
--      principal (nem em caixa alta, nem misturando grafias), em 66.213
--      cadastros que tem principal. O desempate abaixo passa a ser REDE, nao
--      regra de uso diario — e nao deve disparar. Ele fica porque o indice
--      cobre a igualdade exata `= 'PRINCIPAL'`: uma grafia `Principal`, ou com
--      espaco em volta, continua entrando, e sem desempate voltaria o sorteio.
--
--      Conferido depois da higiene: os 7 cadastros da revisao resolvem para o
--      MESMO endereco que o desempate teria escolhido. A higiene e esta
--      migration concordam caso a caso.
--
--   5. `prop` nao e usado em mais nada na funcao: as duas unicas referencias sao
--      `prop.id_int` (a condicao do join) e `prop.id_endereco_ent` (o coalesce).
--      Por isso o join com `propostas` sai por inteiro, desfazendo 22/08.

begin;

do $migracao$
declare
  v_def        text;
  v_novo_def   text;
  v_ocorrencias int;

  -- O bloco como ele esta HOJE, byte a byte, com os fins de linha CRLF que a
  -- funcao usa. Serve de trava: se nao casar exatamente uma vez, nada e escrito.
  v_antigo constant text := E'  left join public.propostas prop\r\n    on prop.id_int = nf.id_int\r\n\r\n  left join public.enderecos e\r\n    on e.id = coalesce(\r\n         nullif(trim(prop.id_endereco_ent), '''')::uuid,\r\n         (select ep.id\r\n            from public.enderecos ep\r\n           where ep.id_cliente = nf.id_cliente::integer\r\n             and lower(trim(ep.tipo_endereco)) = ''principal''\r\n           order by ep.id\r\n           limit 1)\r\n       )';

  -- O principal de `nf.id_cliente` — que a Etapa C faz ser o pagador — com o
  -- desempate deterministico. Sem `propostas`, sem coalesce, sem sorteio.
  v_novo constant text := E'  left join public.enderecos e\r\n    on e.id = (\r\n         select ep.id\r\n           from public.enderecos ep\r\n          where ep.id_cliente = nf.id_cliente::integer\r\n            and lower(trim(ep.tipo_endereco)) = ''principal''\r\n          order by (case when trim(ep.tipo_endereco) = ''PRINCIPAL'' then 0 else 1 end),\r\n                   ep.data_criacao desc nulls last,\r\n                   ep.id\r\n          limit 1\r\n       )';
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'fn_montar_payload_nfe';

  if v_def is null then
    raise exception 'fn_montar_payload_nfe nao existe em public. Nada foi alterado.';
  end if;

  v_ocorrencias := (length(v_def) - length(replace(v_def, v_antigo, ''))) / length(v_antigo);

  if v_ocorrencias <> 1 then
    raise exception
      'O bloco esperado aparece % vez(es) na funcao viva, e nao 1. O corpo divergiu desde a revisao: nada foi alterado.',
      v_ocorrencias;
  end if;

  v_novo_def := replace(v_def, v_antigo, v_novo);

  -- Cinto e suspensorio: o resultado tem de conter o bloco novo e ter perdido o
  -- antigo. Falhando qualquer uma, a transacao inteira volta atras.
  if position(v_novo in v_novo_def) = 0 then
    raise exception 'A substituicao nao produziu o bloco novo. Nada foi alterado.';
  end if;
  if position(v_antigo in v_novo_def) <> 0 then
    raise exception 'O bloco antigo sobreviveu a substituicao. Nada foi alterado.';
  end if;
  -- Terceira guarda, propria desta migration: `prop` tem de sumir por completo.
  -- Sobrar uma referencia significa que a funcao usava o alias em outro lugar e
  -- a definicao nova nao compilaria.
  if position('prop.' in v_novo_def) <> 0 then
    raise exception 'Ainda ha referencia a `prop.` na definicao nova. Nada foi alterado.';
  end if;

  execute v_novo_def;

  raise notice 'fn_montar_payload_nfe atualizada: % -> % bytes.', length(v_def), length(v_novo_def);
end
$migracao$;

commit;

-- VERIFICACAO — RODADA EM 23/08/2026, DEPOIS DE APLICAR
--
--   Projeto conferido antes de escrever: `vwbtitjlpelrcnsytzqw` (o mesmo de
--   .env.local), system_identifier 7509146418464602586, PostgreSQL 17.4 —
--   producao. As leituras de conferencia sairam da mesma conexao que escreveu.
--
--   a) O bloco novo esta na funcao viva, e o antigo sumiu.
--
--   select md5(pg_get_functiondef(p.oid)) as md5_def,
--          length(pg_get_functiondef(p.oid)) as bytes,
--          (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'PRINCIPAL', 'g')) as tem_desempate,
--          (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'id_endereco_ent', 'g')) as resto_do_coalesce,
--          (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'prop\.', 'g')) as resto_do_alias
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'fn_montar_payload_nfe';
--
--     antes   md5 abe0143145ae6d109f9fb3843c571538   15.746 bytes  prop.=2  id_endereco_ent=1
--     depois  md5 a2a9b2732878a1d2a793c39fd91caf5f   15.747 bytes  prop.=0  id_endereco_ent=0
--     tem_desempate = 1. Um byte de diferenca: e a troca de um bloco so.
--
--   b) ACL COMPLETO, com array_agg(grantee). Rodado antes e depois.
--
--   select p.proname, pg_get_userbyid(p.proowner) as dono, p.prosecdef,
--          coalesce(
--            (select array_agg(coalesce(r.rolname, 'PUBLIC') || '=' || x.privilege_type
--                              order by coalesce(r.rolname, 'PUBLIC'), x.privilege_type)
--               from aclexplode(p.proacl) x
--               left join pg_roles r on r.oid = x.grantee),
--            '{}'::text[]) as acl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'fn_montar_payload_nfe';
--
--     IDENTICO nas duas leituras: dono postgres, security definer,
--     {PUBLIC=EXECUTE, anon=EXECUTE, authenticated=EXECUTE, postgres=EXECUTE,
--      service_role=EXECUTE}. O CREATE OR REPLACE nao mexe em privilegio.
--
--   c) AS 3 AUTORIZADAS NAO MUDAM.
--
--      ATENCAO: o payload e PLANO. Nao existe `-> 'nfe' -> 'destinatario'`; os
--      campos sao `nome_destinatario`, `municipio_destinatario`, e assim por
--      diante. Comparar o md5 do conjunto de campos do destinatario:
--
--   with p as (
--     select nf.ref, public.fn_montar_payload_nfe(nf.ref)::jsonb as j
--       from public.notas_fiscais nf
--      where upper(coalesce(nf.status,'')) = 'AUTORIZADA'
--   )
--   select ref,
--          (j ->> 'municipio_destinatario') || '/' || (j ->> 'uf_destinatario') as destino,
--          j ->> 'local_destino' as local_destino,
--          md5(concat_ws('|', j->>'nome_destinatario', j->>'cnpj_destinatario', j->>'cpf_destinatario',
--                        j->>'inscricao_estadual_destinatario', j->>'indicador_inscricao_estadual_destinatario',
--                        j->>'logradouro_destinatario', j->>'numero_destinatario', j->>'complemento_destinatario',
--                        j->>'bairro_destinatario', j->>'municipio_destinatario', j->>'uf_destinatario',
--                        j->>'cep_destinatario', j->>'pais_destinatario', j->>'local_destino')) as md5_destinatario
--     from p order by ref;
--
--     Os tres md5 sao IGUAIS antes e depois:
--       NFE-20370-003  Santa Cruz Do Sul/RS  local 1  CFOP 5101  b738ef6680019be5f04d2de630e087e1
--       NFE-20916-001  Porto Alegre/RS       local 1  CFOP 5101  a993562343ea93bd8cbfd4eef2764546
--       NFE-20925-001  Toledo/PR             local 2  CFOP 6101  ced673a29dd1cef2ef98261512e03a75
--
--   d) O desempate resolve os cadastros da revisao. Rodado depois da higiene:
--      todos com UM principal so, todos em caixa alta, todos no endereco que o
--      desempate escolheria.
--
--        122    GRUPO TERRITORIO   Itabuna/BA
--        248    FX MIDIA           Novo Hamburgo/RS
--        342    INGRESSOPRINT      Porto Alegre/RS
--        471    IMPRIMIX           Goiania/GO
--        980    STUDIO IAN         Santarem/PA
--        37152  MILENE             Rio Grande/RS
--        66235  AUTOMATECH         Porto Alegre/RS
--
--      E os tres pedidos da fila que mudam de destino, pelo pagador:
--        21078 -> GRUPO TERRITORIO  Itabuna/BA   CFOP 6101
--        21074 -> IMPRIMIX          Goiania/GO   CFOP 6101
--        20943 -> GRUPO TERRITORIO  Itabuna/BA   CFOP 6101
--
-- JANELA ENTRE ESTA MIGRATION E A PUBLICACAO DA ETAPA C
--
--   Enquanto a Etapa C nao esta publicada, `notas_fiscais.id_cliente` continua
--   recebendo o CLIENTE do pedido. Logo, ate publicar, o endereco do payload e
--   o principal do CLIENTE — e nao mais o `id_endereco_ent`. Isso e o
--   comportamento anterior a 22/08 e, para o caso comum (cliente e pagador sao
--   a mesma pessoa), e o endereco fiscalmente certo do destinatario.
--
--   O que NAO se deve fazer nessa janela: usar "Reenviar NF-e" nos tres
--   rascunhos em ERRO_AUTORIZACAO do agenciador 8469 — 20872, 20943 e 21078.
--   O reenvio chama `fn_preparar_envio_nfe`, que REMONTA o payload; como o
--   `id_cliente` deles ainda e o agenciador, o endereco sairia Santa Cruz do
--   Sul/RS. Faturar de novo cria rascunho NOVO (a busca so reaproveita
--   PENDENTE) e, com a Etapa C publicada, ja sai certo.
--
--   Os rascunhos PENDENTE e PROCESSANDO nao mudam de endereco: conferido em
--   NFE-20481-001, NFE-20481-002, NFE-20928-001, NFE-20370-001 e NFE-20370-002.
--
-- ROLLBACK
--   Reaplicar o bloco anterior, invertendo v_antigo e v_novo no mesmo DO block.
--   As guardas continuam valendo nos dois sentidos.
--
--   ATENCAO: o rollback desta migration TEM de vir junto do rollback da Etapa C
--   no aplicativo. Voltar so o endereco, mantendo `notas_fiscais.id_cliente` com
--   o pagador, deixa a nota com o nome do pagador e o endereco do agenciador —
--   que e pior do que o estado anterior as duas.
