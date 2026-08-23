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
--   4. UM cadastro tem dois `PRINCIPAL` em caixa alta: AUTOMATECH (66235),
--      Porto Alegre/RS e Extrema/MG, criados com uma hora de diferenca no mesmo
--      dia. Cai no criterio 2 e fica com Porto Alegre/RS, o mais recente. Nao
--      tem pedido na fila nem nota emitida — hoje e inerte.
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

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) o bloco novo esta na funcao viva, e o antigo sumiu
--   select (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'PRINCIPAL', 'g')) as tem_desempate,
--          (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'id_endereco_ent', 'g')) as resto_do_coalesce,
--          (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'prop\.', 'g')) as resto_do_alias
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'fn_montar_payload_nfe';
--   -- esperado: tem_desempate >= 1, resto_do_coalesce = 0, resto_do_alias = 0
--
--   -- b) ACL COMPLETO preservado pelo CREATE OR REPLACE (o execute reaplica a
--   --    mesma definicao, que ja e um CREATE OR REPLACE). Rodar ANTES e DEPOIS
--   --    e comparar: as duas saidas devem ser IDENTICAS.
--   select p.proname,
--          pg_get_userbyid(p.proowner) as dono,
--          p.prosecdef as security_definer,
--          coalesce(
--            (select array_agg(coalesce(r.rolname, 'PUBLIC') || '=' || x.privilege_type
--                              order by coalesce(r.rolname, 'PUBLIC'), x.privilege_type)
--               from aclexplode(p.proacl) x
--               left join pg_roles r on r.oid = x.grantee),
--            '{}'::text[]) as acl
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'fn_montar_payload_nfe';
--
--   -- c) AS 3 AUTORIZADAS NAO MUDAM. Rodar ANTES e DEPOIS e comparar o endereco
--   --    que o payload traz para cada uma. Qualquer diferenca: PARAR.
--   select nf.ref,
--          public.fn_montar_payload_nfe(nf.ref) -> 'nfe' -> 'destinatario' as destinatario
--     from public.notas_fiscais nf
--    where upper(coalesce(nf.status,'')) = 'AUTORIZADA'
--    order by nf.ref;
--
--   -- d) o desempate escolhe a caixa alta nos 5 pagadores duplicados
--   select c.id_cliente, coalesce(nullif(trim(c.fantasia),''), c.nome) as nome,
--          e.tipo_endereco, e.cidade || '/' || e.uf as destino
--     from public.clientes c
--     join lateral (
--       select ep.* from public.enderecos ep
--        where ep.id_cliente = c.id_cliente
--          and lower(trim(ep.tipo_endereco)) = 'principal'
--        order by (case when trim(ep.tipo_endereco) = 'PRINCIPAL' then 0 else 1 end),
--                 ep.data_criacao desc nulls last, ep.id
--        limit 1
--     ) e on true
--    where c.id_cliente in (122, 248, 342, 471, 980);
--   -- esperado: Itabuna/BA, Novo Hamburgo/RS, Porto Alegre/RS, Goiania/GO, Santarem/PA
--
-- ROLLBACK
--   Reaplicar o bloco anterior, invertendo v_antigo e v_novo no mesmo DO block.
--   As guardas continuam valendo nos dois sentidos.
--
--   ATENCAO: o rollback desta migration TEM de vir junto do rollback da Etapa C
--   no aplicativo. Voltar so o endereco, mantendo `notas_fiscais.id_cliente` com
--   o pagador, deixa a nota com o nome do pagador e o endereco do agenciador —
--   que e pior do que o estado anterior as duas.
