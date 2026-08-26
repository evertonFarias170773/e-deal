-- Backfill: devolve para NOVO as propostas que o trigger cancelou sozinho
--
-- O QUE ESTAVA ERRADO
--   Ate 26/08/2026 o ramo "todas as cobrancas canceladas" de
--   public.atualizar_status_financeiro_proposta gravava status_interno =
--   'CANCELADO'. Cancelamento de cobranca e logico (a linha continua em
--   pagamentos_v2), entao a conta dava igual para sempre e a proposta era
--   marcada como cancelada a cada salvamento do orcamento.
--
--   A funcao foi corrigida na migration 20260826_funcao_financeira_nao_cancela_
--   proposta: ela nao escreve mais CANCELADO nem tira proposta de CANCELADO. O
--   laco parou. Este script trata o RESIDUO que ficou para tras — 31 propostas
--   que estao em CANCELADO sem que ninguem tenha mandado cancelar.
--
--   Elas nao se corrigem sozinhas: a consulta de propostas filtra
--   status_interno <> 'CANCELADO', entao ninguem as abre nem as salva, e nao ha
--   trigger que dispare por conta propria.
--
-- COMO AS 31 SAO IDENTIFICADAS (nunca por lista fixa de ids)
--   Tres condicoes, todas estruturais:
--
--     a) status_interno = 'CANCELADO';
--     b) NAO existe em propostas_chat a mensagem 'Proposta cancelada. Motivo: ...'
--        — so /api/orcamentos/cancelar-proposta escreve esse texto, entao a
--        ausencia dele significa que nenhum humano cancelou a proposta;
--     c) tem ao menos uma cobranca E todas estao canceladas — a forma exata que
--        alimentava o ramo defeituoso.
--
--   As 4 propostas canceladas de verdade (19303, 19376, 19432, 21117) ficam de
--   fora por (b) E por (c), independentemente: todas as quatro tem ZERO linhas
--   em pagamentos_v2, entao falham a condicao (c) mesmo que a mensagem de chat
--   sumisse. Sao duas barreiras independentes, nao uma.
--
--   Alem disso o bloco abaixo ABORTA a transacao inteira se:
--     - alguma proposta sem cobranca entrar no recorte (a forma das 4);
--     - qualquer uma das 4 for alcancada;
--     - o recorte crescer alem das 31 conferidas em 26/08/2026.
--   Qualquer uma dessas condicoes exige nova conferencia antes de aplicar.
--
-- POR QUE 'NOVO' E NAO O STATUS ANTERIOR
--   Porque e o que a propria funcao corrigida calcula para elas: sem cobranca
--   valida, o status e NOVO. Depois deste backfill o estado fica estavel — rodar
--   a funcao de novo em qualquer uma delas devolve NOVO e nao escreve nada.
--
-- CUSTO COLATERAL (medido em 26/08/2026)
--   - propostas.updated_at SERA reescrito: dois triggers BEFORE UPDATE
--     (propostas_set_timestamp -> set_timestamp_updated_at e trg_set_updated_at
--     -> set_updated_at) fazem new.updated_at := now(). As 31 vao para o TOPO da
--     lista de Orcamentos, que ordena por updated_at desc e depois id_int desc
--     (orcamentos.service.ts:466). Sao propostas de 13/06 a 26/08 que vao
--     aparecer como as mais recentes. E cosmetico e permanente — nao ha como
--     mudar status sem carimbar updated_at, a nao ser desabilitando trigger, o
--     que este script nao faz.
--   - audit.logs_v2 ganha 31 linhas, uma por proposta (trg_audit_propostas,
--     AFTER UPDATE FOR EACH ROW), com changed_fields contendo status_interno e
--     updated_at.
--   - Nenhum outro trigger de propostas reage a status_interno:
--       tg_registrar_paid_at         so age quando o novo status e 'RECEBIDO';
--       trg_sync_cliente_idcliente_pagamentos  e UPDATE OF cliente, id_cliente;
--       tg_propostas_valor_total_avulsa  so age em is_avulso = true com
--         valor_total nulo ou zero — das 31, 17 sao avulsas e 4 tem valor_total
--         nulo, mas a intersecao e ZERO, entao ele nao grava nada.
--   - Nenhuma escrita em pagamentos_v2, cotacao_frete, produtos_proposta,
--     boletos ou propostas_chat. As cobrancas canceladas continuam canceladas.
--   - As 30 propostas em NOVO com todas as cobrancas canceladas NAO sao tocadas:
--     ja estao no status certo e pararam de oscilar com a correcao da funcao.
--
-- CONFERENCIA DOS SINAIS (feita em 26/08/2026, antes de escrever este script)
--   Varredura em propostas_chat (qualquer mensagem com 'cancel') e em
--   pagamentos_v2.motivo_cancela das 31: 36 registros, TODOS falando de
--   cobranca, nenhum de proposta. Os motivos humanos sao de refaturamento —
--   "vai mudar a forma de pagamento", "boleto incorreto", "vou gerar um
--   e-credito", "vai mudar para E3", "mudou o valor", "valor errado" — e o resto
--   e ruido de teste ou cancelamento automatico do sistema (checkout C6
--   substituido, requisicao duplicada, falha de escopo). Nenhum sinal de
--   cancelamento intencional de proposta.


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — SELECT DE RECORTE. Rodar SOZINHO e conferir a lista ANTES do passo 2.
-- ─────────────────────────────────────────────────────────────────────────────

with alvo as (
  select p.id_int, p.status_interno, p.cliente, p.valor_total, p.created_at, p.updated_at,
         (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int) as cobrancas,
         (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int
            and upper(coalesce(g.status,'')) = 'CANCELADO') as canceladas
  from public.propostas p
  where upper(coalesce(p.status_interno,'')) = 'CANCELADO'
    and not exists (
      select 1 from public.propostas_chat c
      where c.id_int = p.id_int
        and c.mensagem like 'Proposta cancelada. Motivo:%'
    )
)
select id_int,
       status_interno                                as status_atual,
       cobrancas,
       canceladas,
       (cobrancas > 0 and cobrancas = canceladas)    as todas_canceladas,
       false                                         as tem_motivo_da_rota,  -- garantido pelo NOT EXISTS acima
       left(cliente, 40)                             as cliente,
       valor_total,
       to_char(created_at, 'DD/MM/YYYY')             as criada_em,
       to_char(updated_at, 'DD/MM/YYYY HH24:MI')     as ultimo_update
from alvo
where cobrancas > 0 and cobrancas = canceladas
order by id_int;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2 — O UPDATE. Rodar como um bloco unico (BEGIN ... COMMIT).
--
-- Para ENSAIAR sem gravar: troque o COMMIT final por ROLLBACK. O RETURNING
-- mostra exatamente o que seria alterado e a transacao e desfeita.
--
-- GUARDE A SAIDA DO RETURNING — e ela que alimenta o rollback do rodape.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 2a) Travas de seguranca. Qualquer uma aborta a transacao inteira.
do $$
declare
  v_sem_cobranca int;
  v_intocaveis   int;
  v_total        int;
begin
  -- Recorte, repetido aqui exatamente como no UPDATE.
  create temporary table _alvo_backfill on commit drop as
  select p.id_int
  from public.propostas p
  where upper(coalesce(p.status_interno,'')) = 'CANCELADO'
    and not exists (
      select 1 from public.propostas_chat c
      where c.id_int = p.id_int
        and c.mensagem like 'Proposta cancelada. Motivo:%'
    )
    and (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int) > 0
    and (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int)
      = (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int
           and upper(coalesce(g.status,'')) = 'CANCELADO');

  select count(*) into v_total from _alvo_backfill;

  -- Trava A: nenhuma proposta SEM cobranca pode entrar. E a forma das 4
  -- canceladas de verdade, e a barreira que sobrevive mesmo se a mensagem de
  -- chat delas desaparecer.
  select count(*) into v_sem_cobranca
  from _alvo_backfill a
  where (select count(*) from public.pagamentos_v2 g where g.id_int = a.id_int) = 0;

  if v_sem_cobranca > 0 then
    raise exception 'ABORTADO: % proposta(s) sem cobranca entraram no recorte. Conferir antes de aplicar.', v_sem_cobranca;
  end if;

  -- Trava B: as 4 canceladas pela rota propria nao podem ser alcancadas, ponto.
  -- Nao e assim que o recorte seleciona — e uma barreira redundante de proposito.
  select count(*) into v_intocaveis
  from _alvo_backfill where id_int in (19303, 19376, 19432, 21117);

  if v_intocaveis > 0 then
    raise exception 'ABORTADO: o recorte alcancou % proposta(s) cancelada(s) pela rota propria.', v_intocaveis;
  end if;

  -- Trava C: o recorte nao pode ter crescido alem das 31 conferidas em
  -- 26/08/2026. Se cresceu, ha caso novo que ninguem revisou.
  if v_total > 31 then
    raise exception 'ABORTADO: recorte tem % propostas, acima das 31 conferidas em 26/08/2026. Rodar o PASSO 1 e reconferir.', v_total;
  end if;

  raise notice 'Travas OK. % proposta(s) serao devolvidas para NOVO.', v_total;
end $$;

-- 2b) O UPDATE. Mesmo discriminador, nunca lista fixa de ids.
update public.propostas p
   set status_interno = 'NOVO'
 where p.id_int in (select id_int from _alvo_backfill)
returning p.id_int, 'CANCELADO' as status_anterior, p.status_interno as status_novo;

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — Conferencia pos-aplicacao (somente leitura)
-- ─────────────────────────────────────────────────────────────────────────────
--
--   3.1 O residuo zerou (esperado: 0)
--
--     select count(*) from public.propostas p
--     where upper(coalesce(p.status_interno,'')) = 'CANCELADO'
--       and not exists (select 1 from public.propostas_chat c where c.id_int = p.id_int
--                         and c.mensagem like 'Proposta cancelada. Motivo:%')
--       and (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int) > 0;
--
--   3.2 As 4 canceladas de verdade seguem CANCELADO (esperado: 4 linhas)
--
--     select id_int, status_interno from public.propostas
--     where id_int in (19303, 19376, 19432, 21117) order by id_int;
--
--   3.3 Sobraram 4 propostas em CANCELADO no total (esperado: 4)
--
--     select count(*) from public.propostas
--     where upper(coalesce(status_interno,'')) = 'CANCELADO';
--
--   3.4 As 31 linhas de auditoria (esperado: 31)
--
--     select count(*) from audit.logs_v2
--     where table_name = 'propostas' and action = 'UPDATE'
--       and old_data->>'status_interno' = 'CANCELADO'
--       and new_data->>'status_interno' = 'NOVO'
--       and occurred_at > '2026-08-26 00:00:00+00';   -- ajustar para o momento da aplicacao
--
--   3.5 O estado e estavel: rodar a funcao corrigida numa delas nao muda nada
--
--     select public.atualizar_status_financeiro_proposta(21232);
--     select id_int, status_interno from public.propostas where id_int = 21232;  -- NOVO
--
--   3.6 As 30 em NOVO seguem intocadas (esperado: 30)
--
--     select count(*) from public.propostas p
--     where upper(coalesce(p.status_interno,'')) = 'NOVO'
--       and (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int) > 0
--       and (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int)
--         = (select count(*) from public.pagamentos_v2 g where g.id_int = p.id_int
--              and upper(coalesce(g.status,'')) = 'CANCELADO');
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   Este script so muda propostas.status_interno (e updated_at, por trigger).
--   Nao cria objeto, nao apaga nada, nao toca em cobranca.
--
--   updated_at NAO volta ao valor antigo por nenhum destes caminhos — os
--   triggers BEFORE UPDATE carimbam now() de novo. O valor original de cada
--   proposta esta preservado em audit.logs_v2.old_data->>'updated_at', se for
--   preciso recuperar.
--
--   Opcao 1 — pela lista do RETURNING do passo 2b (preferida: e exatamente o
--   conjunto que foi alterado):
--
--     update public.propostas
--        set status_interno = 'CANCELADO'
--      where id_int in ( /* colar aqui os id_int do RETURNING */ );
--
--   Opcao 2 — pela auditoria, se a lista do RETURNING nao tiver sido guardada.
--   AJUSTAR a janela de tempo para a da aplicacao antes de rodar:
--
--     update public.propostas p
--        set status_interno = 'CANCELADO'
--      from (
--        select distinct (l.new_data->>'id_int')::bigint as id_int
--        from audit.logs_v2 l
--        where l.table_name = 'propostas'
--          and l.action = 'UPDATE'
--          and l.old_data->>'status_interno' = 'CANCELADO'
--          and l.new_data->>'status_interno' = 'NOVO'
--          and l.occurred_at between '<inicio>' and '<fim>'
--      ) reverter
--     where p.id_int = reverter.id_int
--       and p.status_interno = 'NOVO';   -- nao reverte o que mudou depois
-- ─────────────────────────────────────────────────────────────────────────────
