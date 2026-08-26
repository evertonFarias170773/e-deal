-- atualizar_status_financeiro_proposta para de cancelar e de reabrir proposta
--
-- O QUE ESTAVA ERRADO
--   A funcao tem dois ramos de "nao ha cobranca valida":
--
--     ramo 1  v_total_pagamentos = 0            -> grava 'NOVO'
--     ramo 2  v_total_cancelados = v_total_pag  -> grava 'CANCELADO'
--
--   Os dois estao errados, cada um de um jeito.
--
--   RAMO 2 — cancela proposta que ninguem mandou cancelar.
--   Cobranca cancelada continua existindo em pagamentos_v2 (cancelamento e
--   logico), entao a conta "todas canceladas" da igual para sempre. Cancelar a
--   ultima cobranca de uma proposta a marca como CANCELADO; o app reverte para
--   NOVO logo depois (reverterStatusPropostaSeSemCobranca), mas a reversao e
--   pontual e o trigger e permanente: o proximo salvamento do orcamento escreve
--   em produtos_proposta/cotacao_frete, o trigger roda de novo e a proposta
--   volta a CANCELADO.
--
--   Reproduzido na proposta 21232 em 26/08/2026 (audit.logs_v2):
--
--     14:50:12.403  status_interno  AGUARDANDO -> CANCELADO   <- ramo 2
--     14:50:25.806  status_interno  CANCELADO  -> NOVO        <- reversao do app
--     14:50:26.714  status_interno  NOVO -> AGUARDANDO        <- save do orcamento
--     14:50:26.862  status_interno  AGUARDANDO -> CANCELADO   <- ramo 2 de novo, 150ms depois
--
--   RAMO 1 — reabre proposta que foi cancelada de proposito.
--   Proposta cancelada pela rota /api/orcamentos/cancelar-proposta fica, na
--   pratica, sem nenhuma linha em pagamentos_v2 (as 4 canceladas de verdade em
--   producao tem ZERO cobrancas). Qualquer escrita em produtos_proposta ou
--   cotacao_frete dessas propostas cai no ramo 1 e as devolve para NOVO. O
--   buraco esta aberto hoje; ainda nao disparou porque ninguem tocou nos itens
--   dessas quatro depois do cancelamento.
--
--   AMPLITUDE MEDIDA EM 26/08/2026
--     35 propostas em CANCELADO no total;
--      4 delas tem a mensagem 'Proposta cancelada. Motivo: ...' em
--        propostas_chat, que so a rota propria escreve — sao as legitimas;
--     31 nao tem mensagem nenhuma: vieram do ramo 2. Essas 31 acumulam 66
--        eventos de cancelamento em audit.logs_v2 (media de 2,1 por proposta) —
--        a rota e idempotente e retorna cedo se ja esta CANCELADO, entao
--        cancelamento repetido so o trigger produz;
--     30 propostas em NOVO tem todas as cobrancas canceladas: sao as que voltam
--        para CANCELADO no proximo salvamento;
--      2 em EM PRODUCAO na mesma condicao — protegidas pela guarda de
--        20260825, o ramo 2 nao as alcanca.
--
-- O QUE MUDA
--   Somente os ramos 1 e 2, nas duas sobrecargas. Passam a ser a mesma regra:
--
--     nao ha cobranca valida -> 'NOVO', E SO SE a proposta nao estiver CANCELADA
--
--   Ou seja, esta funcao nunca mais escreve 'CANCELADO' e nunca mais tira uma
--   proposta de 'CANCELADO'. Proposta sem cobranca valida e proposta a
--   refaturar; cancelar proposta e ato proprio, com rota, permissao e motivo.
--
--   v_status_atual ja existia (guarda de 20260825) — nenhuma variavel nova.
--
--   Corpos extraidos do corpo VIVO via pg_get_functiondef em 26/08/2026 e
--   conferidos por hash. As diferencas entre as sobrecargas (a contagem de
--   v_tem_pendente da versao integer tambem considera A_VENCER/PAID nao
--   confirmados; a bigint olha so A_RECEBER; comentarios diferentes) foram
--   preservadas.
--
-- REATIVACAO CONTINUA FUNCIONANDO
--   Proposta CANCELADA que recebe cobranca nova NAO cai nos ramos 1 e 2 — ela
--   tem pagamento, e nem todos cancelados. Cai nos ramos 3/4 (pendente /
--   aprovado), que seguem sem guarda, e volta para AGUARDANDO ou APROVADO. Era
--   exatamente por isso que 'CANCELADO' ficou de fora da guarda em 20260825, e
--   continua de fora: o que se fecha aqui e so o caminho de reabrir SEM
--   cobranca nenhuma.
--
-- O QUE NAO MUDA
--   - ramos 3 e 4 (AGUARDANDO / APROVADO) — intocados;
--   - a guarda de status protegido de 20260825 — intocada;
--   - nenhum trigger criado, removido ou alterado;
--   - check_and_promote_proposta, atualizar_status_proposta_por_pagamento e
--     status-protegidos.ts — intocados;
--   - nenhum backfill. As 31 ja em CANCELADO NAO se corrigem sozinhas: elas
--     estao fora das listas (a consulta de propostas filtra
--     status_interno <> 'CANCELADO'), entao ninguem as abre nem as salva, e nao
--     ha trigger que dispare por conta propria. Precisam de acao separada.
--
-- DEPENDE DE UMA MUDANCA NO APP — LER ANTES DE APLICAR
--   /api/orcamentos/cancelar-proposta cancela as cobrancas (passo 3) e SO
--   DEPOIS grava CANCELADO na proposta (passo 6), com trava otimista
--   .eq("status_interno", <status lido antes>).
--
--   Hoje, quando a proposta tem cobranca pendente, quem grava o CANCELADO e
--   ESTA FUNCAO, via o ramo 2 disparado no passo 3. A trava otimista do passo 6
--   falha (o status ja mudou), a rota reconsulta, encontra CANCELADO e trata
--   como sucesso — ha ate um comentario no codigo dizendo "(trigger ou chamada
--   concorrente identica) — segue como sucesso".
--
--   Com esta migration o ramo 2 passa a gravar NOVO. A trava otimista continua
--   falhando, mas a reconsulta encontra NOVO, nao CANCELADO, e a rota devolve
--   409 CONFLITO_CONCORRENCIA com as cobrancas ja canceladas e a proposta NAO
--   cancelada.
--
--   Essa combinacao nunca rodou em producao (as 4 propostas canceladas de
--   verdade tinham zero cobrancas, entao o passo 3 nao cancelou nada e a trava
--   segurou), mas o caminho e alcancavel no primeiro cancelamento de proposta
--   com cobranca pendente.
--
--   CORRECAO NECESSARIA, a aplicar JUNTO com esta migration:
--   reler o status logo antes do passo 6 e travar nele, em vez de travar no
--   status lido no inicio da requisicao. Mantem a protecao contra concorrencia e
--   remove o acoplamento acidental ao efeito colateral do trigger.
--
-- KILL-SWITCH NATURAL
--   Enquanto nenhuma proposta estiver em CANCELADO, o novo teste e sempre
--   verdadeiro e os dois ramos se comportam como o ramo 1 de hoje.


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

  -- Sem pagamento nenhum: proposta volta ao inicio do funil. Nunca reabre
  -- proposta cancelada — cancelamento e ato proprio e so a rota desfaz.
  if v_total_pagamentos = 0 then
    if coalesce(v_status_atual, '') <> 'CANCELADO' then
      update public.propostas
         set status_interno = 'NOVO'
       where id_int = p_id_int;
    end if;
    return;
  end if;

  select count(*)
    into v_total_cancelados
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status,'')) = 'CANCELADO';

  -- Todas as cobrancas canceladas: proposta A REFATURAR, nao proposta morta.
  -- Mesmo tratamento de "sem pagamentos". Esta funcao nao cancela proposta.
  if v_total_cancelados = v_total_pagamentos then
    if coalesce(v_status_atual, '') <> 'CANCELADO' then
      update public.propostas
         set status_interno = 'NOVO'
       where id_int = p_id_int;
    end if;
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

  -- sem pagamentos = NOVO, mas nunca reabrindo proposta cancelada
  if v_total_pagamentos = 0 then
    if coalesce(v_status_atual, '') <> 'CANCELADO' then
      update public.propostas
         set status_interno = 'NOVO'
       where id_int = p_id_int;
    end if;
    return;
  end if;

  -- total cancelados
  select count(*)
    into v_total_cancelados
  from public.pagamentos_v2
  where id_int = p_id_int
    and upper(coalesce(status, '')) = 'CANCELADO';

  -- todas canceladas = proposta a refaturar (NOVO), nao proposta morta.
  -- Esta funcao nao cancela proposta e nao reabre proposta cancelada.
  if v_total_cancelados = v_total_pagamentos then
    if coalesce(v_status_atual, '') <> 'CANCELADO' then
      update public.propostas
         set status_interno = 'NOVO'
       where id_int = p_id_int;
    end if;
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
--    3.1 A funcao nao escreve mais CANCELADO (esperado: 2 linhas, ambas false)
--
--      select pg_get_function_identity_arguments(p.oid) as args,
--             pg_get_functiondef(p.oid) like '%status_interno = ''CANCELADO''%' as ainda_cancela
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname='public' and p.proname='atualizar_status_financeiro_proposta'
--      order by args;
--
--    3.2 Nenhum trigger tocado (esperado: os 3 de sempre)
--
--      select c.relname, t.tgname, md5(pg_get_triggerdef(t.oid))
--      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
--      where not t.tgisinternal and p.proname in ('tg_recalc_financeiro_por_produto',
--            'tg_recalc_financeiro_por_frete','tg_sync_status_financeiro_proposta')
--      order by c.relname, t.tgname;
--
--    3.3 As 4 canceladas de verdade seguem canceladas (esperado: 4 linhas CANCELADO)
--
--      select id_int, status_interno from public.propostas
--      where id_int in (19303, 19376, 19432, 21117) order by id_int;
--
--    3.4 Teste vivo do laco: cancelar a ultima cobranca de uma proposta e salvar
--        o orcamento. Recorte no valor que esta mudanca sabe escrever —
--        contagem total nunca fecha em banco em uso.
--        Esperado DEPOIS: zero linhas.
--
--      select occurred_at, coalesce(new_data->>'id_int', old_data->>'id_int') as id_int,
--             old_data->>'status_interno' as de, new_data->>'status_interno' as para
--      from audit.logs_v2
--      where table_name='propostas' and action='UPDATE'
--        and changed_fields ? 'status_interno'
--        and new_data->>'status_interno' = 'CANCELADO'
--        and occurred_at > '2026-08-26 00:00:00+00'   -- ajustar para o momento da aplicacao
--      order by occurred_at desc;
--
--    3.5 Residuo conhecido, NAO corrigido por esta migration (esperado: 31)
--
--      select count(*) from public.propostas p
--      where upper(coalesce(p.status_interno,''))='CANCELADO'
--        and not exists (select 1 from public.propostas_chat c
--                         where c.id_int=p.id_int
--                           and c.mensagem like 'Proposta cancelada. Motivo:%');
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — definicoes VIVAS em 26/08/2026, antes desta migration
--   (ou seja, o estado deixado pela migration 20260825, com a guarda de status
--   protegido ja presente)
--
--   Restaurar as funcoes abaixo faz o ramo 2 voltar a gravar CANCELADO e o ramo
--   1 voltar a reabrir proposta cancelada. Nenhum objeto novo foi criado e
--   nenhuma linha de dado foi alterada por esta migration.
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
--   v_status_atual text;
-- begin
--   -- GUARDA DE STATUS PROTEGIDO
--   -- Evidencia financeira nao move etapa produtiva. Da liberacao em diante o
--   -- status so muda pelas transicoes oficiais do fluxo — salvar o orcamento
--   -- (que escreve em produtos_proposta e em cotacao_frete, disparando esta
--   -- funcao) nao e uma delas.
--   -- Lista do ITEM A de check_and_promote_proposta, MENOS 'CANCELADO' (que
--   -- precisa seguir reativavel por nova cobranca), MAIS 'REVISAO ATENDENTE' e
--   -- 'ENTREGUE', que ja constam em status-protegidos.ts no app.
--   select upper(coalesce(status_interno, ''))
--     into v_status_atual
--   from public.propostas
--   where id_int = p_id_int;
--
--   if coalesce(v_status_atual, '') in (
--        'REVISAO ATENDENTE',
--        'REVISAO PRODUCAO',
--        'EM PRODUCAO',
--        'EM IMPRESSAO',
--        'EM IMPRESSAO / PENDENTE',
--        'EM ACABAMENTO',
--        'EM ACABAMENTO / PENDENTE',
--        'EXPEDICAO',
--        'A RETIRAR',
--        'EM TRANSITO',
--        'ENTREGUE',
--        'RECEBIDO'
--      ) then
--     return;
--   end if;
--
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
--   v_status_atual text;
-- begin
--   -- GUARDA DE STATUS PROTEGIDO — ver comentario na sobrecarga integer.
--   select upper(coalesce(status_interno, ''))
--     into v_status_atual
--   from public.propostas
--   where id_int = p_id_int;
--
--   if coalesce(v_status_atual, '') in (
--        'REVISAO ATENDENTE',
--        'REVISAO PRODUCAO',
--        'EM PRODUCAO',
--        'EM IMPRESSAO',
--        'EM IMPRESSAO / PENDENTE',
--        'EM ACABAMENTO',
--        'EM ACABAMENTO / PENDENTE',
--        'EXPEDICAO',
--        'A RETIRAR',
--        'EM TRANSITO',
--        'ENTREGUE',
--        'RECEBIDO'
--      ) then
--     return;
--   end if;
--
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
