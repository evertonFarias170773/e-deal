-- Guarda de status protegido em atualizar_status_financeiro_proposta
--
-- O QUE ESTAVA ERRADO
--   public.atualizar_status_financeiro_proposta reescreve propostas.status_interno
--   para NOVO / AGUARDANDO / APROVADO / CANCELADO SEM olhar o status atual. Ela e
--   chamada por tres triggers:
--
--     trg_produto_sync_financeiro  em produtos_proposta (AFTER INSERT/UPDATE/DELETE)
--       -> tg_recalc_financeiro_por_produto
--     trg_frete_sync_financeiro    em cotacao_frete     (AFTER INSERT/UPDATE/DELETE)
--       -> tg_recalc_financeiro_por_frete
--     trg_sync_status_proposta     em pagamentos_v2     (AFTER INSERT/UPDATE/DELETE)
--       -> tg_sync_status_financeiro_proposta
--
--   As duas primeiras sao o problema: TODO salvamento de orcamento escreve em
--   produtos_proposta e em cotacao_frete (o save apaga e reinsere a linha do frete
--   escolhido). Resultado: editar endereco, modalidade de frete, contato ou valor de
--   um pedido que ja passou da liberacao rebaixa o status_interno.
--
--   Editar pedido pronto e fluxo aceito na operacao. O rebaixamento nao e.
--
--   EVIDENCIA (audit.logs_v2, proposta 20943, 25/08/2026 — autor everton.prd@gmail.com):
--
--     00:55:33.471  UPDATE propostas  cep, valor, valor_frete, valor_total,
--                                     frete_escolhido, id_endereco_ent, texto_whatsapp
--                                     <- o save do app; status_interno NAO mudou
--     00:55:33.881  UPDATE propostas  status_interno: EXPEDICAO -> APROVADO   <- ESTA FUNCAO
--     00:55:37.399  UPDATE propostas  status_interno: APROVADO -> REVISAO ATENDENTE
--
--   O segundo salto e consequencia, nao causa: aplicarStatusRecomendadoProposta
--   (rota /api/orcamentos/editar-paga, origem AUTO_FINANCEIRO) releu o status do
--   banco, encontrou o APROVADO ja corrompido e fez a promocao CORRETA a partir de
--   uma premissa errada. Registrado em propostas_chat as 00:55:37.
--
--   Nenhuma linha do app grava status_interno = 'APROVADO' — a engine aposentou esse
--   valor (status-engine.service.ts:18, "APROVADO e mantido apenas como valor legado
--   de leitura, nunca mais escrito por esta engine"). Todo '-> APROVADO' no banco de
--   hoje sai daqui.
--
--   Alcance medido em audit.logs_v2 (60 dias, updates cujo UNICO campo alterado e
--   status_interno e cujo destino e um dos quatro valores que esta funcao escreve):
--
--     LIBERADO          -> APROVADO    2247
--     REVISAO ATENDENTE -> APROVADO      48
--     EM PRODUCAO       -> NOVO          36
--     LIBERADO          -> AGUARDANDO    14
--     LIBERADO          -> NOVO          14
--     EM PRODUCAO       -> APROVADO       8
--     EM PRODUCAO       -> CANCELADO      8
--     EM PRODUCAO       -> AGUARDANDO     8
--     EXPEDICAO         -> APROVADO       6
--     REVISAO ATENDENTE -> AGUARDANDO     6
--     EM IMPRESSAO      -> APROVADO       5
--     LIBERADO          -> CANCELADO      1
--     REVISAO ATENDENTE -> NOVO           1
--
-- O QUE MUDA
--   Somente o corpo das DUAS sobrecargas de atualizar_status_financeiro_proposta
--   (integer e bigint). Um guard-clause entra ANTES de qualquer contagem: se a
--   proposta ja passou da liberacao, a funcao retorna sem escrever.
--
--   Os corpos abaixo foram extraidos do corpo VIVO em producao via
--   pg_get_functiondef em 25/08/2026, nao de arquivo do repositorio. As duas
--   sobrecargas TEM diferencas reais entre si (a contagem de v_tem_pendente da
--   versao integer tambem considera A_VENCER/PAID nao confirmados; a versao bigint
--   olha so A_RECEBER) e essas diferencas foram preservadas byte a byte. A UNICA
--   alteracao em cada uma e a declaracao de v_status_atual e o bloco de guarda.
--
--   A lista de status protegidos e a uniao das duas listas que o sistema ja usa:
--     - check_and_promote_proposta, bloco "ITEM A" (banco);
--     - src/features/orcamentos/services/status-protegidos.ts (app).
--   Nenhum status novo foi inventado aqui.
--
-- O QUE NAO MUDA
--   - nenhum trigger e criado, removido ou alterado;
--   - check_and_promote_proposta e atualizar_status_proposta_por_pagamento ficam
--     intocadas (decisoes separadas);
--   - status-protegidos.ts fica intocado;
--   - a FASE COMERCIAL segue identica: NOVO, AGUARDANDO, APROVADO, LIBERADO e as
--     variantes "/ EM ARTE" continuam fora da guarda, e a funcao continua
--     reconciliando esses estados como sempre fez. Os 2247 LIBERADO -> APROVADO
--     continuam acontecendo — o valor APROVADO gravado por esta funcao NAO e
--     assunto desta migration;
--   - nenhum backfill, nenhum UPDATE de status. Conferido em 25/08/2026: nao ha
--     nenhuma proposta em NOVO/AGUARDANDO/APROVADO/CANCELADO com is_prd_aprovado
--     = true ou com linha em expedicoes — zero residuo a corrigir.
--
-- CANCELADO FICOU DE FORA, DE PROPOSITO
--   check_and_promote_proposta lista CANCELADO no ITEM A, mas aqui ele NAO entra
--   na guarda. Motivo: esta funcao e o caminho pelo qual uma proposta cancelada
--   volta a vida quando o cliente fecha de novo — nova cobranca em pagamentos_v2
--   dispara trg_sync_status_proposta, e a reconciliacao devolve a proposta para
--   AGUARDANDO/APROVADO. Guardar CANCELADO travaria essa reativacao e exigiria um
--   fluxo manual que hoje nao existe.
--
--   O eixo corrigido aqui e outro: pedido que JA PASSOU da liberacao nao pode ser
--   rebaixado por uma edicao de orcamento. CANCELADO nao faz parte desse eixo.
--
-- KILL-SWITCH NATURAL
--   Enquanto nenhuma proposta estiver num status protegido, o guard e sempre falso
--   e as funcoes sao bit a bit as de hoje.


-- 1. Sobrecarga integer ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atualizar_status_financeiro_proposta(p_id_int integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_total_pagamentos int := 0;
  v_total_cancelados int := 0;
  v_tem_pendente int := 0;
  v_tem_aprovado int := 0;
  v_status_atual text;
begin
  -- GUARDA DE STATUS PROTEGIDO
  -- Evidencia financeira nao move etapa produtiva. Da liberacao em diante o
  -- status so muda pelas transicoes oficiais do fluxo — salvar o orcamento
  -- (que escreve em produtos_proposta e em cotacao_frete, disparando esta
  -- funcao) nao e uma delas.
  -- Lista do ITEM A de check_and_promote_proposta, MENOS 'CANCELADO' (que
  -- precisa seguir reativavel por nova cobranca), MAIS 'REVISAO ATENDENTE' e
  -- 'ENTREGUE', que ja constam em status-protegidos.ts no app.
  select upper(coalesce(status_interno, ''))
    into v_status_atual
  from public.propostas
  where id_int = p_id_int;

  if coalesce(v_status_atual, '') in (
       'REVISAO ATENDENTE',
       'REVISAO PRODUCAO',
       'EM PRODUCAO',
       'EM IMPRESSAO',
       'EM IMPRESSAO / PENDENTE',
       'EM ACABAMENTO',
       'EM ACABAMENTO / PENDENTE',
       'EXPEDICAO',
       'A RETIRAR',
       'EM TRANSITO',
       'ENTREGUE',
       'RECEBIDO'
     ) then
    return;
  end if;

  select count(*)
    into v_total_pagamentos
  from public.pagamentos_v2
  where id_int = p_id_int;

  if v_total_pagamentos = 0 then
    update public.propostas
       set status_interno = 'NOVO'
     where id_int = p_id_int;
    return;
  end if;

  select count(*)
    into v_total_cancelados
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status,'')) = 'CANCELADO';

  if v_total_cancelados = v_total_pagamentos then
    update public.propostas
       set status_interno = 'CANCELADO'
     where id_int = p_id_int;
    return;
  end if;

  select count(*)
    into v_tem_pendente
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status,'')) <> 'CANCELADO'
    and (
      upper(coalesce(status,'')) = 'A_RECEBER'
      or (upper(coalesce(status,'')) in ('A_VENCER','PAID') and coalesce(confirmado,false) = false)
    );

  if v_tem_pendente > 0 then
    update public.propostas
       set status_interno = 'AGUARDANDO'
     where id_int = p_id_int;
    return;
  end if;

  select count(*)
    into v_tem_aprovado
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status,'')) in ('A_VENCER','PAID')
    and coalesce(confirmado,false) = true;

  if v_tem_aprovado > 0 then
    update public.propostas
       set status_interno = 'APROVADO'
     where id_int = p_id_int;
    return;
  end if;

  update public.propostas
     set status_interno = 'AGUARDANDO'
   where id_int = p_id_int;
end;
$function$;


-- 2. Sobrecarga bigint -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atualizar_status_financeiro_proposta(p_id_int bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_total_pagamentos int := 0;
  v_total_cancelados int := 0;
  v_tem_pendente int := 0;
  v_tem_aprovado int := 0;
  v_status_atual text;
begin
  -- GUARDA DE STATUS PROTEGIDO — ver comentario na sobrecarga integer.
  select upper(coalesce(status_interno, ''))
    into v_status_atual
  from public.propostas
  where id_int = p_id_int;

  if coalesce(v_status_atual, '') in (
       'REVISAO ATENDENTE',
       'REVISAO PRODUCAO',
       'EM PRODUCAO',
       'EM IMPRESSAO',
       'EM IMPRESSAO / PENDENTE',
       'EM ACABAMENTO',
       'EM ACABAMENTO / PENDENTE',
       'EXPEDICAO',
       'A RETIRAR',
       'EM TRANSITO',
       'ENTREGUE',
       'RECEBIDO'
     ) then
    return;
  end if;

  -- total de pagamentos da proposta
  select count(*)
    into v_total_pagamentos
  from public.pagamentos_v2
  where id_int = p_id_int;

  -- sem pagamentos = NOVO
  if v_total_pagamentos = 0 then
    update public.propostas
       set status_interno = 'NOVO'
     where id_int = p_id_int;
    return;
  end if;

  -- total cancelados
  select count(*)
    into v_total_cancelados
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status, '')) = 'CANCELADO';

  -- se todos estão cancelados = CANCELADO
  if v_total_cancelados = v_total_pagamentos then
    update public.propostas
       set status_interno = 'CANCELADO'
     where id_int = p_id_int;
    return;
  end if;

  -- existe algum A_RECEBER? então fica AGUARDANDO
  select count(*)
    into v_tem_pendente
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status, '')) = 'A_RECEBER';

  if v_tem_pendente > 0 then
    update public.propostas
       set status_interno = 'AGUARDANDO'
     where id_int = p_id_int;
    return;
  end if;

  -- existe algum A_VENCER ou PAID confirmado? então APROVADO
  select count(*)
    into v_tem_aprovado
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status, '')) in ('A_VENCER', 'PAID')
    and confirmado = true;

  if v_tem_aprovado > 0 then
    update public.propostas
       set status_interno = 'APROVADO'
     where id_int = p_id_int;
    return;
  end if;

  -- qualquer outro cenário com pagamento existente = AGUARDANDO
  update public.propostas
     set status_interno = 'AGUARDANDO'
   where id_int = p_id_int;

end;
$function$;


-- 3. Conferencia pos-aplicacao (somente leitura) ------------------------------
--
--    3.1 As duas sobrecargas passaram a ter a guarda (esperado: 2 linhas, ambas true)
--
--      select pg_get_function_identity_arguments(p.oid) as args,
--             pg_get_functiondef(p.oid) like '%REVISAO ATENDENTE%' as tem_guarda
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname = 'atualizar_status_financeiro_proposta'
--      order by args;
--
--    3.2 Nenhum trigger foi tocado (esperado: os 3 de sempre, definicoes iguais)
--
--      select c.relname, t.tgname, pg_get_triggerdef(t.oid)
--      from pg_trigger t
--      join pg_class c on c.oid = t.tgrelid
--      join pg_proc  p on p.oid = t.tgfoid
--      where not t.tgisinternal
--        and p.proname in ('tg_recalc_financeiro_por_produto',
--                          'tg_recalc_financeiro_por_frete',
--                          'tg_sync_status_financeiro_proposta')
--      order by c.relname, t.tgname;
--
--    3.3 Teste vivo do eixo corrigido — salvar o orcamento de uma proposta em
--        EXPEDICAO e conferir que o status NAO se move. A contagem total de
--        propostas nunca fecha num banco em uso; o recorte abaixo mira so o que
--        esta mudanca sabe escrever. Esperado: zero linhas DEPOIS da aplicacao.
--
--      select occurred_at,
--             coalesce(new_data->>'id_int', old_data->>'id_int') as id_int,
--             old_data->>'status_interno' as de,
--             new_data->>'status_interno' as para,
--             actor_email
--      from audit.logs_v2
--      where table_name = 'propostas'
--        and action = 'UPDATE'
--        and changed_fields ? 'status_interno'
--        and new_data->>'status_interno' in ('NOVO','AGUARDANDO','APROVADO','CANCELADO')
--        and upper(coalesce(old_data->>'status_interno','')) in (
--              'REVISAO ATENDENTE','REVISAO PRODUCAO','EM PRODUCAO','EM IMPRESSAO',
--              'EM IMPRESSAO / PENDENTE','EM ACABAMENTO','EM ACABAMENTO / PENDENTE',
--              'EXPEDICAO','A RETIRAR','EM TRANSITO','ENTREGUE','RECEBIDO')
--        and occurred_at > '2026-08-25 12:00:00+00'   -- ajustar para o momento da aplicacao
--      order by occurred_at desc;
--
--    3.4 Residuo (esperado: zero linhas, ja era zero ANTES da aplicacao)
--
--      select p.id_int, p.status_interno, p.is_prd_aprovado, e.data_despacho, p.updated_at
--      from public.propostas p
--      left join lateral (
--        select x.id, x.data_despacho from public.expedicoes x
--        where x.id_int = p.id_int order by x.created_at desc limit 1
--      ) e on true
--      where upper(coalesce(p.status_interno,'')) in ('NOVO','AGUARDANDO','APROVADO','CANCELADO')
--        and (p.is_prd_aprovado is true or e.id is not null)
--      order by p.updated_at desc;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — definicoes VIVAS em 25/08/2026, antes desta migration
--
--   Restaurar as duas funcoes abaixo faz a reconciliacao financeira voltar a
--   reescrever status_interno a partir de qualquer status, inclusive EXPEDICAO.
--   Nenhum objeto novo foi criado, entao nao ha nada a remover. Nenhuma linha de
--   dado foi alterada por esta migration, entao nao ha dado a restaurar.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE FUNCTION public.atualizar_status_financeiro_proposta(p_id_int integer)
--  RETURNS void
--  LANGUAGE plpgsql
-- AS $function$
-- declare
--   v_total_pagamentos int := 0;
--   v_total_cancelados int := 0;
--   v_tem_pendente int := 0;
--   v_tem_aprovado int := 0;
-- begin
--   select count(*)
--     into v_total_pagamentos
--   from public.pagamentos_v2
--   where id_int = p_id_int;
--
--   if v_total_pagamentos = 0 then
--     update public.propostas
--        set status_interno = 'NOVO'
--      where id_int = p_id_int;
--     return;
--   end if;
--
--   select count(*)
--     into v_total_cancelados
--   from public.pagamentos_v2
--   where id_int = p_id_int
--     and upper(coalesce(status,'')) = 'CANCELADO';
--
--   if v_total_cancelados = v_total_pagamentos then
--     update public.propostas
--        set status_interno = 'CANCELADO'
--      where id_int = p_id_int;
--     return;
--   end if;
--
--   select count(*)
--     into v_tem_pendente
--   from public.pagamentos_v2
--   where id_int = p_id_int
--     and upper(coalesce(status,'')) <> 'CANCELADO'
--     and (
--       upper(coalesce(status,'')) = 'A_RECEBER'
--       or (upper(coalesce(status,'')) in ('A_VENCER','PAID') and coalesce(confirmado,false) = false)
--     );
--
--   if v_tem_pendente > 0 then
--     update public.propostas
--        set status_interno = 'AGUARDANDO'
--      where id_int = p_id_int;
--     return;
--   end if;
--
--   select count(*)
--     into v_tem_aprovado
--   from public.pagamentos_v2
--   where id_int = p_id_int
--     and upper(coalesce(status,'')) in ('A_VENCER','PAID')
--     and coalesce(confirmado,false) = true;
--
--   if v_tem_aprovado > 0 then
--     update public.propostas
--        set status_interno = 'APROVADO'
--      where id_int = p_id_int;
--     return;
--   end if;
--
--   update public.propostas
--      set status_interno = 'AGUARDANDO'
--    where id_int = p_id_int;
-- end;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.atualizar_status_financeiro_proposta(p_id_int bigint)
--  RETURNS void
--  LANGUAGE plpgsql
-- AS $function$
-- declare
--   v_total_pagamentos int := 0;
--   v_total_cancelados int := 0;
--   v_tem_pendente int := 0;
--   v_tem_aprovado int := 0;
-- begin
--   -- total de pagamentos da proposta
--   select count(*)
--     into v_total_pagamentos
--   from public.pagamentos_v2
--   where id_int = p_id_int;
--
--   -- sem pagamentos = NOVO
--   if v_total_pagamentos = 0 then
--     update public.propostas
--        set status_interno = 'NOVO'
--      where id_int = p_id_int;
--     return;
--   end if;
--
--   -- total cancelados
--   select count(*)
--     into v_total_cancelados
--   from public.pagamentos_v2
--   where id_int = p_id_int
--     and upper(coalesce(status, '')) = 'CANCELADO';
--
--   -- se todos estão cancelados = CANCELADO
--   if v_total_cancelados = v_total_pagamentos then
--     update public.propostas
--        set status_interno = 'CANCELADO'
--      where id_int = p_id_int;
--     return;
--   end if;
--
--   -- existe algum A_RECEBER? então fica AGUARDANDO
--   select count(*)
--     into v_tem_pendente
--   from public.pagamentos_v2
--   where id_int = p_id_int
--     and upper(coalesce(status, '')) = 'A_RECEBER';
--
--   if v_tem_pendente > 0 then
--     update public.propostas
--        set status_interno = 'AGUARDANDO'
--      where id_int = p_id_int;
--     return;
--   end if;
--
--   -- existe algum A_VENCER ou PAID confirmado? então APROVADO
--   select count(*)
--     into v_tem_aprovado
--   from public.pagamentos_v2
--   where id_int = p_id_int
--     and upper(coalesce(status, '')) in ('A_VENCER', 'PAID')
--     and confirmado = true;
--
--   if v_tem_aprovado > 0 then
--     update public.propostas
--        set status_interno = 'APROVADO'
--      where id_int = p_id_int;
--     return;
--   end if;
--
--   -- qualquer outro cenário com pagamento existente = AGUARDANDO
--   update public.propostas
--      set status_interno = 'AGUARDANDO'
--    where id_int = p_id_int;
--
-- end;
-- $function$;
