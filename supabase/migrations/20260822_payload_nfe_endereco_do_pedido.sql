-- O endereco de destino do payload passa a sair do endereco escolhido no pedido
--
-- POR QUE
--   Tres fontes decidiam a UF de destino e discordavam. Duas ja foram unificadas
--   no TypeScript; esta e a terceira:
--
--     - o rascunho (createOrReuseNfeDraft) segue `propostas.id_endereco_ent` e
--       dai decide o CFOP do item: mesma UF do emitente -> 5101, outra -> 6101;
--     - esta funcao ignorava `id_endereco_ent` e juntava `enderecos` pelo cliente
--       com `tipo_endereco = 'principal'`, e dai decidia `local_destino` (idDest)
--       e o bloco inteiro do endereco do destinatario.
--
--   Quando o cliente tem sede num estado e recebe em outro, as duas divergem. Foi
--   o caso da NFE-20872-001, em 22/08/2026: endereco do pedido em Santarem/PA,
--   endereco principal do cadastro em Santa Cruz do Sul/RS. O item saiu com CFOP
--   6101 (interestadual) e o payload com local_destino 1 (interna). A SEFAZ
--   recusou com o codigo 732: "CFOP de operacao interestadual e idDest <> 2".
--
-- POR QUE ESTA MIGRATION NAO CARREGA UMA COPIA DA FUNCAO
--   Um CREATE OR REPLACE com o corpo copiado para o arquivo regride producao em
--   silencio se o corpo vivo tiver mudado desde a copia. Entao esta migration NAO
--   copia nada: ela le a definicao viva com pg_get_functiondef, troca so o bloco
--   do join, e reaplica. Se o bloco esperado nao estiver la exatamente uma vez,
--   ela ABORTA sem escrever - nao ha como regredir por divergencia.
--
--   Efeito colateral util: rodar duas vezes falha na segunda, porque o join
--   antigo ja nao existe. Isso e guarda, nao defeito.
--
-- MEDIDO NO BANCO VIVO EM 22/08/2026, ANTES DE APLICAR
--   definicao viva ......... 15.454 bytes, md5 b72aa1c70c134cd37f19e5778e4a77fe
--   uma sobrecarga so ...... fn_montar_payload_nfe(p_ref text), SECURITY DEFINER
--   bloco do join .......... 127 bytes, 1 ocorrencia, posicao 15008
--   definicao resultante ... 15.746 bytes, md5 abe0143145ae6d109f9fb3843c571538
--
-- O QUE MUDA NAS NOTAS EXISTENTES
--   Nada e reescrito por esta migration: `payload_envio` so e remontado quando
--   alguem prepara o envio daquela nota de novo. O que muda e a RESOLUCAO daqui
--   para a frente. Medido sobre as 48 notas:
--
--     - 40 NAO tem `id_endereco_ent` na proposta de origem. Para elas nada muda:
--       o coalesce mantem o endereco principal do cliente. Sem o coalesce, essas
--       40 perderiam o endereco do destinatario inteiro;
--     - o `local_destino` muda em 2:
--         NFE-20872-001  (ERRO_AUTORIZACAO, ja recusada com 732)  1 -> 2
--         NFE-21078-001  (PRONTA_PARA_ENVIO, ainda nao emitida)   1 -> 2
--     - NENHUMA nota AUTORIZADA muda de resolucao. A NFE-20925-001 (Toledo/PR
--       nos dois lados) continua com idDest 2, como ja esta.
--
-- O `order by ep.id limit 1` DO FALLBACK
--   8 clientes tem mais de um endereco marcado como principal. O join antigo
--   escolhia um deles sem criterio, podendo variar entre execucoes. O limit
--   torna a escolha estavel.
--
-- NAO FAZ
--   Nao altera dado, nao apaga nada, nao mexe em RLS, permissoes ou historico.
--   Nao toca a NFE-17536-001.
--
-- REVERSAO
--   O mesmo desenho, trocando `v_antigo` por `v_novo` e vice-versa: le a
--   definicao viva, devolve o join de `enderecos` por cliente + principal, e
--   reaplica.
--
-- APLICADA EM PRODUCAO em 22/08/2026, com autorizacao explicita.
--   antes .... 15.454 bytes, md5 b72aa1c70c134cd37f19e5778e4a77fe
--   depois ... 15.746 bytes, md5 abe0143145ae6d109f9fb3843c571538
--   Os dois hashes bateram com os previstos na revisao. Nenhuma nota foi
--   escrita: a migration troca funcao, nao dado.

begin;

do $migracao$
declare
  v_def       text;
  v_novo_def  text;
  v_ocorrencias int;

  -- Os dois literais ficam em UMA linha cada, de proposito: literais E'' em
  -- linhas adjacentes NAO se concatenam em PL/pgSQL, e quebra-los assim custou
  -- um erro de sintaxe na primeira tentativa de aplicar. O bloco nem chegou a
  -- rodar - e a funcao ficou intacta, como as guardas garantem.

  -- O join como ele estava, byte a byte, com os fins de linha CRLF que a funcao
  -- usa. Serve de trava: se nao casar, nada e escrito.
  v_antigo constant text := E'  left join public.enderecos e\r\n    on e.id_cliente = nf.id_cliente::integer\r\n   and lower(trim(e.tipo_endereco)) = ''principal''';

  -- O endereco escolhido no pedido manda. Na ausencia dele, o principal do
  -- cadastro, que preserva as notas anteriores a essa escolha.
  v_novo constant text := E'  left join public.propostas prop\r\n    on prop.id_int = nf.id_int\r\n\r\n  left join public.enderecos e\r\n    on e.id = coalesce(\r\n         nullif(trim(prop.id_endereco_ent), '''')::uuid,\r\n         (select ep.id\r\n            from public.enderecos ep\r\n           where ep.id_cliente = nf.id_cliente::integer\r\n             and lower(trim(ep.tipo_endereco)) = ''principal''\r\n           order by ep.id\r\n           limit 1)\r\n       )';
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
      'O join esperado aparece % vez(es) na funcao viva, e nao 1. O corpo divergiu desde a revisao: nada foi alterado.',
      v_ocorrencias;
  end if;

  v_novo_def := replace(v_def, v_antigo, v_novo);

  -- Cinto e suspensorio: o resultado tem de conter o novo join e ter perdido o
  -- antigo. Se qualquer uma falhar, a transacao inteira volta atras.
  if position(v_novo in v_novo_def) = 0 then
    raise exception 'A substituicao nao produziu o join novo. Nada foi alterado.';
  end if;
  if position(v_antigo in v_novo_def) <> 0 then
    raise exception 'O join antigo sobreviveu a substituicao. Nada foi alterado.';
  end if;

  execute v_novo_def;

  raise notice 'fn_montar_payload_nfe atualizada: % -> % bytes.', length(v_def), length(v_novo_def);
end
$migracao$;

commit;
