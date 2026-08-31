-- =====================================================================
-- Corrige clientes.id_cliente do cadastro MN LASER: 123133 -> 133
-- =====================================================================
--
-- O QUE
-- -----
-- O cadastro "MN LASER - VENDA E OUTSOURCING DE IMPRESSORAS E SUPRIMENTOS
-- LTDA" (uuid 06b02257-a529-4734-aa5b-4a769c7ea1e9, documento 33921425000192)
-- nasceu em 28/08/2026 com id_cliente = 123133 por erro de digitacao. O valor
-- correto e 133, que esta livre. Esta migration troca o valor no cadastro e nas
-- 12 linhas que apontam para ele, numa transacao unica.
--
-- POR QUE NAO E UM UPDATE SIMPLES
-- -------------------------------
-- `clientes.id_cliente` NAO e a chave primaria (a PK e `id`, uuid). E uma chave
-- de negocio com UNIQUE (clientes_id_cliente_key), atribuida pela aplicacao:
-- sem default, sem identity, sem sequence. Nao ha sequence para acertar depois.
--
-- Nove chaves estrangeiras apontam para ela, e TODAS sao ON UPDATE NO ACTION e
-- NAO ADIAVEIS (condeferrable = false). Uma unica delas tem linha filha apontando
-- para 123133: fk_cliente_socio, em clientes_socios.id_cliente_socio (1 linha).
-- Isso cria um impasse circular:
--
--   * atualizar `clientes` primeiro  -> a linha filha fica orfa -> a FK aborta;
--   * atualizar a filha primeiro     -> o 133 ainda nao existe -> a FK aborta.
--
-- Sem DEFERRABLE nenhuma ordem de operacoes resolve: aqui NO ACTION se comporta
-- igual a RESTRICT. Por isso a constraint e tornada adiavel SO durante esta
-- transacao, e devolvida a NOT DEFERRABLE antes do fim — o proprio ALTER de volta
-- forca a checagem imediata e serve como assercao final.
--
-- Mesmo padrao ja usado em 20260827170336_propostas_liberado_producao_em.sql
-- para os triggers de updated_at: desarmar o minimo, pelo menor tempo possivel,
-- dentro da transacao, e rearmar antes do commit.
--
-- O QUE FOI VERIFICADO ANTES (somente leitura, 31/08/2026)
-- --------------------------------------------------------
-- * o 133 esta livre: zero linha em public.clientes;
-- * 12 linhas filhas, em 6 tabelas, todas ligadas a UMA proposta, a 21368
--   (cliente do pedido = LISITON 8469; o MN LASER e o PAGADOR):
--     propostas_chat.id_cliente ......................... 5
--     enderecos.id_cliente .............................. 2
--     pagamentos_v2.id_cliente .......................... 2
--     clientes_socios.id_cliente_socio (FK) ............. 1
--     expedicoes.id_cliente_destinatario_etiqueta ....... 1
--     propostas.id_faturado ............................. 1
-- * o MN LASER NUNCA foi cliente de proposta alguma (propostas.id_cliente = 0);
-- * ZERO linha em boletos, pagamentos (v1), movimento_credito (Conta Corrente),
--   conta_corrente_pendencias, contatos, notas_fiscais, notas_servico,
--   clientes_precos_fixos, propostas_pendencias, maestro_acoes e producao_acesso_*;
-- * o literal '123133' NAO aparece em nenhum campo de texto (chat, descricao de
--   cobranca, propostas.cliente): as 12 referencias sao colunas numericas de id;
-- * nao existe nota fiscal para a 21368, entao nada foi transmitido a SEFAZ;
-- * ZERO view materializada no banco. As 8 views que dependem de `clientes` sao
--   comuns e leem ao vivo — nada a recriar;
-- * RLS nao depende do valor: nenhuma policy do schema public cita id_cliente;
-- * os 3 triggers de `clientes` nao escrevem id_cliente, e `clientes` nao tem
--   coluna updated_at (nem trigger de timestamp);
-- * n8n: dos 89 workflows, 15 citam id_cliente e TODOS o usam apenas em nos
--   Supabase/code. ZERO nos httpRequest/webhook carregam id_cliente — o valor
--   nunca sai do nosso banco. Os fluxos PIX/Inter casam por txid, id_pagamento,
--   cod_solicitacao_inter, id_int e documento, nunca por id_cliente.
--
-- O QUE ESTA MIGRATION TOCA EM DINHEIRO
-- -------------------------------------
-- Duas linhas de pagamentos_v2, ambas da proposta 21368, ambas PIX:
--   * 1 CANCELADO   (cod_solicitacao_inter QRS2TXUETQQKRFCAEQXPYPVEYZJAZEK2Z4X)
--   * 1 PAID/confirmado, R$ 154,80, pago em 28/08/2026 15:41:32
--                     (cod_solicitacao_inter QRS1TXGMBK5L6L76ODBEIXRYTREZT0DEUTC)
-- SO a coluna id_cliente muda. valor, status, confirmado, paid_at e
-- cod_solicitacao_inter sao conferidos ANTES e DEPOIS, e qualquer alteracao neles
-- aborta a transacao inteira.
--
-- PRE-REQUISITO JA EXECUTADO (31/08/2026, autorizado explicitamente)
-- ------------------------------------------------------------------
-- Um endereco ORFAO ocupava o destino e fez a primeira tentativa abortar. Foi
-- removido por DELETE pelo id da propria linha, antes desta aplicacao:
--
--   id c9bbb346-5251-49b7-a3dd-fdd1a1c7fff7 | id_cliente 133 | PRINCIPAL
--   R: Silvio Rizzardo, 1502 - Jd. Londres - Campinas/SP - CEP 13060077
--   data_criacao 2025-12-20T19:31:28.321425
--
-- Sem cadastro correspondente em `clientes`, e `enderecos` nao tem FK. A tabela
-- tambem NAO tem trigger de auditoria, entao a copia acima e em
-- scratch/endereco-orfao-133-apagado.md sao o unico registro da linha.
-- Nenhum outro dos ~346 orfaos conhecidos foi tocado.
--
-- EFEITO COLATERAL ACEITO
-- -----------------------
-- A URL /cadastros/123133 deixa de existir. Link salvo, aba aberta ou documento
-- impresso com esse numero passam a dar "nao encontrado". Nao ha redirecionamento.
-- =====================================================================

do $corrige$
declare
  v_id_antigo   constant integer := 123133;
  v_id_novo     constant integer := 133;
  v_uuid        constant uuid    := '06b02257-a529-4734-aa5b-4a769c7ea1e9';
  v_documento   constant text    := '33921425000192';
  v_inter_pago  constant text    := 'QRS1TXGMBK5L6L76ODBEIXRYTREZT0DEUTC';

  v_n              integer;
  v_pix_paid_at    timestamptz;
  v_pix_valor      numeric;
  v_total_antes    integer;
  v_total_depois   integer;
begin
  -- ------------------------------------------------------------------
  -- 1. TRAVA as linhas envolvidas ate o fim da transacao.
  --    Impede que outra sessao escreva no cadastro ou nas filhas entre a
  --    assercao e o UPDATE.
  -- ------------------------------------------------------------------
  perform 1 from public.clientes            where id_cliente = v_id_antigo                     for update;
  perform 1 from public.clientes_socios     where id_cliente_socio = v_id_antigo               for update;
  perform 1 from public.propostas           where id_faturado = v_id_antigo                    for update;
  perform 1 from public.expedicoes          where id_cliente_destinatario_etiqueta = v_id_antigo for update;
  perform 1 from public.enderecos           where id_cliente = v_id_antigo                     for update;
  perform 1 from public.pagamentos_v2       where id_cliente = v_id_antigo                     for update;
  perform 1 from public.propostas_chat      where id_cliente = v_id_antigo                     for update;

  -- ------------------------------------------------------------------
  -- 2. ASSERCOES DE ENTRADA. Qualquer divergencia aborta tudo.
  -- ------------------------------------------------------------------

  -- 2.1 o destino precisa estar livre EM TODA PARTE, nao so em `clientes`.
  --
  -- A primeira tentativa (31/08/2026, 15:22) abortou aqui — e nao nesta
  -- assercao, que so olhava `clientes`, mas la na frente, no UPDATE de
  -- enderecos:
  --
  --   ERROR 23505: duplicate key value violates unique constraint
  --   "enderecos_um_principal_por_cliente"  DETAIL: Key (id_cliente)=(133)
  --
  -- Havia um endereco ORFAO (Campinas/SP, PRINCIPAL) apontando para o 133 sem
  -- cadastro correspondente — `enderecos` nao tem FK para `clientes`. Dois
  -- PRINCIPAIS no mesmo id_cliente colidem no indice unico parcial
  -- `enderecos_um_principal_por_cliente (id_cliente) WHERE tipo_endereco='PRINCIPAL'`.
  --
  -- A licao: livre na tabela de cadastros NAO e o mesmo que livre nas tabelas
  -- satelite. A varredura abaixo cobre as MESMAS 24 colunas usadas na assercao
  -- de saida, entao o destino e conferido com o mesmo rigor que a origem.
  select
      (select count(*) from public.clientes                  where id_cliente = v_id_novo)
    + (select count(*) from public.boletos                   where id_cliente = v_id_novo)
    + (select count(*) from public.clientes_precos_fixos     where id_cliente = v_id_novo)
    + (select count(*) from public.clientes_socios           where id_cliente_principal = v_id_novo)
    + (select count(*) from public.clientes_socios           where id_cliente_socio = v_id_novo)
    + (select count(*) from public.conta_corrente_pendencias where id_cliente = v_id_novo)
    + (select count(*) from public.contatos                  where id_cliente = v_id_novo)
    + (select count(*) from public.enderecos                 where id_cliente = v_id_novo)
    + (select count(*) from public.expedicoes                where id_cliente_destinatario_etiqueta = v_id_novo)
    + (select count(*) from public.expedicoes                where id_transportadora_cliente = v_id_novo)
    + (select count(*) from public.maestro_acoes             where id_cliente = v_id_novo)
    + (select count(*) from public.movimento_credito         where id_cliente = v_id_novo)
    + (select count(*) from public.notas_fiscais             where id_cliente = v_id_novo)
    + (select count(*) from public.notas_fiscais             where id_transportadora_cliente = v_id_novo)
    + (select count(*) from public.notas_servico             where id_cliente = v_id_novo)
    + (select count(*) from public.pagamentos                where id_cliente = v_id_novo)
    + (select count(*) from public.pagamentos_v2             where id_cliente = v_id_novo)
    + (select count(*) from public.producao_acesso_contas    where id_cliente = v_id_novo)
    + (select count(*) from public.producao_acesso_eventos   where id_cliente = v_id_novo)
    + (select count(*) from public.propostas                 where id_cliente = v_id_novo)
    + (select count(*) from public.propostas                 where id_faturado = v_id_novo)
    + (select count(*) from public.propostas                 where id_transportadora_cliente = v_id_novo)
    + (select count(*) from public.propostas_chat            where id_cliente = v_id_novo)
    + (select count(*) from public.propostas_pendencias      where id_cliente = v_id_novo)
    into v_n;
  if v_n <> 0 then
    raise exception 'ABORTADO: o destino id_cliente % nao esta livre — ha % referencia(s) a ele nas 24 colunas mapeadas (cadastro, orfao em tabela satelite, ou ambos). Localizar e tratar ANTES de tentar a troca.', v_id_novo, v_n;
  end if;

  -- 2.2 a origem precisa existir, e ser exatamente o cadastro esperado
  select count(*) into v_n
    from public.clientes
   where id_cliente = v_id_antigo and id = v_uuid and documento = v_documento;
  if v_n <> 1 then
    raise exception 'ABORTADO: nao encontrei exatamente 1 cadastro com id_cliente=%, id=% e documento=%. Encontrei %.', v_id_antigo, v_uuid, v_documento, v_n;
  end if;

  -- 2.3 as 12 contagens precisam bater com o mapeamento de 31/08/2026
  select count(*) into v_n from public.propostas_chat where id_cliente = v_id_antigo;
  if v_n <> 5 then raise exception 'ABORTADO: propostas_chat tem % linha(s), esperado 5. O alcance mudou desde o mapeamento — refazer o levantamento.', v_n; end if;

  select count(*) into v_n from public.enderecos where id_cliente = v_id_antigo;
  if v_n <> 2 then raise exception 'ABORTADO: enderecos tem % linha(s), esperado 2.', v_n; end if;

  select count(*) into v_n from public.pagamentos_v2 where id_cliente = v_id_antigo;
  if v_n <> 2 then raise exception 'ABORTADO: pagamentos_v2 tem % linha(s), esperado 2. Cobranca nova ou removida — parar e reavaliar o risco financeiro.', v_n; end if;

  select count(*) into v_n from public.clientes_socios where id_cliente_socio = v_id_antigo;
  if v_n <> 1 then raise exception 'ABORTADO: clientes_socios tem % linha(s), esperado 1.', v_n; end if;

  select count(*) into v_n from public.expedicoes where id_cliente_destinatario_etiqueta = v_id_antigo;
  if v_n <> 1 then raise exception 'ABORTADO: expedicoes tem % linha(s), esperado 1.', v_n; end if;

  select count(*) into v_n from public.propostas where id_faturado = v_id_antigo;
  if v_n <> 1 then raise exception 'ABORTADO: propostas.id_faturado tem % linha(s), esperado 1.', v_n; end if;

  -- 2.4 nada pode ter aparecido nas tabelas que estavam zeradas
  select
      (select count(*) from public.boletos                   where id_cliente = v_id_antigo)
    + (select count(*) from public.pagamentos                where id_cliente = v_id_antigo)
    + (select count(*) from public.movimento_credito         where id_cliente = v_id_antigo)
    + (select count(*) from public.conta_corrente_pendencias where id_cliente = v_id_antigo)
    + (select count(*) from public.contatos                  where id_cliente = v_id_antigo)
    + (select count(*) from public.notas_fiscais             where id_cliente = v_id_antigo)
    + (select count(*) from public.notas_fiscais             where id_transportadora_cliente = v_id_antigo)
    + (select count(*) from public.notas_servico             where id_cliente = v_id_antigo)
    + (select count(*) from public.clientes_precos_fixos     where id_cliente = v_id_antigo)
    + (select count(*) from public.propostas_pendencias      where id_cliente = v_id_antigo)
    + (select count(*) from public.maestro_acoes             where id_cliente = v_id_antigo)
    + (select count(*) from public.producao_acesso_contas    where id_cliente = v_id_antigo)
    + (select count(*) from public.producao_acesso_eventos   where id_cliente = v_id_antigo)
    + (select count(*) from public.propostas                 where id_cliente = v_id_antigo)
    + (select count(*) from public.propostas                 where id_transportadora_cliente = v_id_antigo)
    + (select count(*) from public.expedicoes                where id_transportadora_cliente = v_id_antigo)
    + (select count(*) from public.clientes_socios           where id_cliente_principal = v_id_antigo)
    into v_n;
  if v_n <> 0 then
    raise exception 'ABORTADO: apareceram % referencia(s) em tabelas que estavam zeradas no mapeamento. Refazer o levantamento antes de prosseguir.', v_n;
  end if;

  -- 2.5 retrato do PIX PAGO, para conferir depois
  select paid_at, valor into v_pix_paid_at, v_pix_valor
    from public.pagamentos_v2
   where id_cliente = v_id_antigo and cod_solicitacao_inter = v_inter_pago;
  if v_pix_paid_at is null then
    raise exception 'ABORTADO: nao encontrei o PIX pago (cod_solicitacao_inter=%) ou ele esta sem paid_at.', v_inter_pago;
  end if;

  -- 12 filhas (5+2+2+1+1+1). O cadastro em si e contado a parte.
  v_total_antes := 12;
  raise notice 'Entrada OK. Alvo: % -> %. 12 linhas filhas + o cadastro. PIX pago R$ % em %.', v_id_antigo, v_id_novo, v_pix_valor, v_pix_paid_at;

  -- ------------------------------------------------------------------
  -- 3. Torna ADIAVEL apenas a UNICA FK com linha filha, e adia a checagem.
  --    As outras 8 FKs nao sao tocadas: nenhuma tem linha apontando para
  --    123133, entao nao entram no caminho.
  -- ------------------------------------------------------------------
  execute 'alter table public.clientes_socios alter constraint fk_cliente_socio deferrable initially deferred';
  set constraints public.fk_cliente_socio deferred;

  -- ------------------------------------------------------------------
  -- 4. A TROCA. Pai primeiro; a ordem e indiferente com a checagem adiada.
  -- ------------------------------------------------------------------
  update public.clientes        set id_cliente = v_id_novo where id_cliente = v_id_antigo and id = v_uuid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'ABORTADO: o UPDATE do cadastro afetou % linha(s), esperado 1.', v_n; end if;

  update public.clientes_socios set id_cliente_socio = v_id_novo                 where id_cliente_socio = v_id_antigo;
  get diagnostics v_n = row_count;  v_total_depois := v_n;

  update public.propostas       set id_faturado = v_id_novo                      where id_faturado = v_id_antigo;
  get diagnostics v_n = row_count;  v_total_depois := v_total_depois + v_n;

  update public.expedicoes      set id_cliente_destinatario_etiqueta = v_id_novo where id_cliente_destinatario_etiqueta = v_id_antigo;
  get diagnostics v_n = row_count;  v_total_depois := v_total_depois + v_n;

  update public.enderecos       set id_cliente = v_id_novo                       where id_cliente = v_id_antigo;
  get diagnostics v_n = row_count;  v_total_depois := v_total_depois + v_n;

  -- Financeiro: SO id_cliente. Nenhuma outra coluna entra neste SET.
  update public.pagamentos_v2   set id_cliente = v_id_novo                       where id_cliente = v_id_antigo;
  get diagnostics v_n = row_count;  v_total_depois := v_total_depois + v_n;

  update public.propostas_chat  set id_cliente = v_id_novo                       where id_cliente = v_id_antigo;
  get diagnostics v_n = row_count;  v_total_depois := v_total_depois + v_n;

  -- `v_total_depois` soma SO as filhas; o cadastro ja foi conferido acima (1 linha).
  if v_total_depois <> v_total_antes then
    raise exception 'ABORTADO: foram atualizadas % linha(s) filha(s), esperado %.', v_total_depois, v_total_antes;
  end if;

  -- ------------------------------------------------------------------
  -- 5. Devolve a constraint a NOT DEFERRABLE. Isto FORCA a checagem imediata
  --    das pendencias: se alguma linha tivesse ficado orfa, morre aqui.
  -- ------------------------------------------------------------------
  execute 'alter table public.clientes_socios alter constraint fk_cliente_socio not deferrable';

  -- ------------------------------------------------------------------
  -- 6. ASSERCOES DE SAIDA
  -- ------------------------------------------------------------------

  -- 6.1 zero referencia ao id antigo, nas 24 colunas mapeadas
  select
      (select count(*) from public.clientes                  where id_cliente = v_id_antigo)
    + (select count(*) from public.boletos                   where id_cliente = v_id_antigo)
    + (select count(*) from public.clientes_precos_fixos     where id_cliente = v_id_antigo)
    + (select count(*) from public.clientes_socios           where id_cliente_principal = v_id_antigo)
    + (select count(*) from public.clientes_socios           where id_cliente_socio = v_id_antigo)
    + (select count(*) from public.conta_corrente_pendencias where id_cliente = v_id_antigo)
    + (select count(*) from public.contatos                  where id_cliente = v_id_antigo)
    + (select count(*) from public.enderecos                 where id_cliente = v_id_antigo)
    + (select count(*) from public.expedicoes                where id_cliente_destinatario_etiqueta = v_id_antigo)
    + (select count(*) from public.expedicoes                where id_transportadora_cliente = v_id_antigo)
    + (select count(*) from public.maestro_acoes             where id_cliente = v_id_antigo)
    + (select count(*) from public.movimento_credito         where id_cliente = v_id_antigo)
    + (select count(*) from public.notas_fiscais             where id_cliente = v_id_antigo)
    + (select count(*) from public.notas_fiscais             where id_transportadora_cliente = v_id_antigo)
    + (select count(*) from public.notas_servico             where id_cliente = v_id_antigo)
    + (select count(*) from public.pagamentos                where id_cliente = v_id_antigo)
    + (select count(*) from public.pagamentos_v2             where id_cliente = v_id_antigo)
    + (select count(*) from public.producao_acesso_contas    where id_cliente = v_id_antigo)
    + (select count(*) from public.producao_acesso_eventos   where id_cliente = v_id_antigo)
    + (select count(*) from public.propostas                 where id_cliente = v_id_antigo)
    + (select count(*) from public.propostas                 where id_faturado = v_id_antigo)
    + (select count(*) from public.propostas                 where id_transportadora_cliente = v_id_antigo)
    + (select count(*) from public.propostas_chat            where id_cliente = v_id_antigo)
    + (select count(*) from public.propostas_pendencias      where id_cliente = v_id_antigo)
    into v_n;
  if v_n <> 0 then
    raise exception 'ABORTADO: sobraram % referencia(s) ao id_cliente % apos a troca.', v_n, v_id_antigo;
  end if;

  -- 6.2 o cadastro existe com o id novo, mesma identidade
  select count(*) into v_n
    from public.clientes
   where id_cliente = v_id_novo and id = v_uuid and documento = v_documento;
  if v_n <> 1 then
    raise exception 'ABORTADO: o cadastro nao esta com id_cliente=% e a mesma identidade apos a troca.', v_id_novo;
  end if;

  -- 6.3 as 12 FILHAS apontam para o id novo (o cadastro ja foi conferido em 6.2)
  select
      (select count(*) from public.clientes_socios     where id_cliente_socio = v_id_novo)
    + (select count(*) from public.propostas           where id_faturado = v_id_novo)
    + (select count(*) from public.expedicoes          where id_cliente_destinatario_etiqueta = v_id_novo)
    + (select count(*) from public.enderecos           where id_cliente = v_id_novo)
    + (select count(*) from public.pagamentos_v2       where id_cliente = v_id_novo)
    + (select count(*) from public.propostas_chat      where id_cliente = v_id_novo)
    into v_n;
  if v_n <> 12 then
    raise exception 'ABORTADO: % linha(s) filha(s) apontam para o id_cliente %, esperado 12.', v_n, v_id_novo;
  end if;

  -- 6.4 o PIX PAGO segue intacto em tudo que nao e id_cliente
  select count(*) into v_n
    from public.pagamentos_v2
   where id_cliente = v_id_novo
     and cod_solicitacao_inter = v_inter_pago
     and status = 'PAID'
     and confirmado is true
     and valor = 154.80
     and paid_at = v_pix_paid_at;
  if v_n <> 1 then
    raise exception 'ABORTADO: o PIX pago nao passou na conferencia (esperado valor 154.80, status PAID, confirmado true, paid_at % e cod_solicitacao_inter % inalterados).', v_pix_paid_at, v_inter_pago;
  end if;

  -- 6.5 a constraint voltou ao estado original
  select count(*) into v_n
    from pg_constraint
   where conname = 'fk_cliente_socio'
     and conrelid = 'public.clientes_socios'::regclass
     and condeferrable is false;
  if v_n <> 1 then
    raise exception 'ABORTADO: fk_cliente_socio NAO voltou para NOT DEFERRABLE.';
  end if;

  raise notice 'OK: % -> % concluido. 12 filhas + o cadastro migrados, PIX pago intacto, fk_cliente_socio NOT DEFERRABLE.', v_id_antigo, v_id_novo;
end
$corrige$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT, fora da transacao)
-- =====================================================================
--
-- (a) o cadastro:
--     select id, id_cliente, nome, documento, ativo from public.clientes
--      where id = '06b02257-a529-4734-aa5b-4a769c7ea1e9';
--     -- esperado: id_cliente = 133
--
-- (b) nenhuma sobra do id antigo (deve voltar 0):
--     select (select count(*) from public.clientes       where id_cliente = 123133)
--          + (select count(*) from public.clientes_socios where id_cliente_socio = 123133)
--          + (select count(*) from public.propostas       where id_faturado = 123133)
--          + (select count(*) from public.expedicoes      where id_cliente_destinatario_etiqueta = 123133)
--          + (select count(*) from public.enderecos       where id_cliente = 123133)
--          + (select count(*) from public.pagamentos_v2   where id_cliente = 123133)
--          + (select count(*) from public.propostas_chat  where id_cliente = 123133) as sobras;
--
-- (c) as 12 filhas + o cadastro no destino (deve voltar 13):
--     select (select count(*) from public.clientes        where id_cliente = 133)
--          + (select count(*) from public.clientes_socios where id_cliente_socio = 133)
--          + (select count(*) from public.propostas       where id_faturado = 133)
--          + (select count(*) from public.expedicoes      where id_cliente_destinatario_etiqueta = 133)
--          + (select count(*) from public.enderecos       where id_cliente = 133)
--          + (select count(*) from public.pagamentos_v2   where id_cliente = 133)
--          + (select count(*) from public.propostas_chat  where id_cliente = 133) as migradas;
--
-- (d) o PIX pago:
--     select id_int, id_cliente, status, confirmado, valor, paid_at, cod_solicitacao_inter
--       from public.pagamentos_v2 where id_cliente = 133 order by created_at;
--     -- esperado: 2 linhas, id_int 21368; a PAID com 154.80, confirmado true,
--     --           paid_at 2026-08-28 15:41:32.971+00 e
--     --           cod_solicitacao_inter QRS1TXGMBK5L6L76ODBEIXRYTREZT0DEUTC
--
-- (e) as 9 FKs seguem NOT DEFERRABLE (deve voltar 9):
--     select count(*) from pg_constraint
--      where contype='f' and confrelid='public.clientes'::regclass and condeferrable is false;
--
-- (f) a proposta 21368 continua coerente:
--     select id_int, id_cliente, id_faturado, status_interno from public.propostas where id_int = 21368;
--     -- esperado: id_cliente = 8469 (LISITON), id_faturado = 133 (MN LASER)
--
--
-- =====================================================================
-- ROLLBACK (operacao espelhada, 133 -> 123133)
-- =====================================================================
-- Nao ha nada apagado em nenhum dos sentidos: e a mesma troca, invertida.
-- Rodar INTEIRO, numa transacao so.
--
-- do $rollback$
-- declare
--   v_id_atual constant integer := 133;
--   v_id_volta constant integer := 123133;
--   v_uuid     constant uuid    := '06b02257-a529-4734-aa5b-4a769c7ea1e9';
--   v_n integer;
--   v_total integer;
-- begin
--   perform 1 from public.clientes        where id_cliente = v_id_atual for update;
--   perform 1 from public.clientes_socios where id_cliente_socio = v_id_atual for update;
--   perform 1 from public.propostas       where id_faturado = v_id_atual for update;
--   perform 1 from public.expedicoes      where id_cliente_destinatario_etiqueta = v_id_atual for update;
--   perform 1 from public.enderecos       where id_cliente = v_id_atual for update;
--   perform 1 from public.pagamentos_v2   where id_cliente = v_id_atual for update;
--   perform 1 from public.propostas_chat  where id_cliente = v_id_atual for update;
--
--   select count(*) into v_n from public.clientes where id_cliente = v_id_volta;
--   if v_n <> 0 then raise exception 'ABORTADO: id_cliente % voltou a ser ocupado.', v_id_volta; end if;
--
--   select count(*) into v_n from public.clientes where id_cliente = v_id_atual and id = v_uuid;
--   if v_n <> 1 then raise exception 'ABORTADO: o cadastro % nao e o esperado.', v_id_atual; end if;
--
--   execute 'alter table public.clientes_socios alter constraint fk_cliente_socio deferrable initially deferred';
--   set constraints public.fk_cliente_socio deferred;
--
--   update public.clientes        set id_cliente = v_id_volta                       where id_cliente = v_id_atual and id = v_uuid;
--   get diagnostics v_total = row_count;
--   update public.clientes_socios set id_cliente_socio = v_id_volta                 where id_cliente_socio = v_id_atual;
--   get diagnostics v_n = row_count; v_total := v_total + v_n;
--   update public.propostas       set id_faturado = v_id_volta                      where id_faturado = v_id_atual;
--   get diagnostics v_n = row_count; v_total := v_total + v_n;
--   update public.expedicoes      set id_cliente_destinatario_etiqueta = v_id_volta where id_cliente_destinatario_etiqueta = v_id_atual;
--   get diagnostics v_n = row_count; v_total := v_total + v_n;
--   update public.enderecos       set id_cliente = v_id_volta                       where id_cliente = v_id_atual;
--   get diagnostics v_n = row_count; v_total := v_total + v_n;
--   update public.pagamentos_v2   set id_cliente = v_id_volta                       where id_cliente = v_id_atual;
--   get diagnostics v_n = row_count; v_total := v_total + v_n;
--   update public.propostas_chat  set id_cliente = v_id_volta                       where id_cliente = v_id_atual;
--   get diagnostics v_n = row_count; v_total := v_total + v_n;
--
--   execute 'alter table public.clientes_socios alter constraint fk_cliente_socio not deferrable';
--
--   -- 12 filhas + o cadastro
--   if v_total <> 13 then raise exception 'ABORTADO: rollback moveu % linha(s), esperado 13.', v_total; end if;
--
--   select count(*) into v_n from public.pagamentos_v2
--    where id_cliente = v_id_volta and status = 'PAID' and confirmado is true and valor = 154.80;
--   if v_n <> 1 then raise exception 'ABORTADO: o PIX pago nao sobreviveu ao rollback.'; end if;
--
--   raise notice 'Rollback OK: % -> %, 12 linhas.', v_id_atual, v_id_volta;
-- end
-- $rollback$;
--
--
-- SOCORRO: se a transacao morrer DEPOIS do primeiro ALTER e a constraint ficar
-- adiavel (nao deveria acontecer — o rollback da transacao desfaz DDL no
-- Postgres —, mas fica registrado):
--
--   alter table public.clientes_socios alter constraint fk_cliente_socio not deferrable;
--
-- PLANO B: se o `set constraints` for recusado neste servidor, a alternativa
-- equivalente e dropar e recriar a FK dentro da MESMA transacao, entre os
-- UPDATEs — o ADD revalida a tabela inteira e substitui a checagem forcada:
--
--   alter table public.clientes_socios drop constraint fk_cliente_socio;
--   -- ... os 7 UPDATEs ...
--   alter table public.clientes_socios
--     add constraint fk_cliente_socio foreign key (id_cliente_socio)
--     references public.clientes (id_cliente);
-- =====================================================================
