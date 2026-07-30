-- ============================================================================
-- 20260730_rpc_cobranca_reprovar_condicao.sql
--
-- RPC transacional da acao "Reprovar e cancelar cobranca" (Conferencia de
-- Pagamentos -> modal Analise de Faturamento -> aba Reprovar).
--
-- Causa do risco: a reprovacao fazia DUAS escritas separadas do frontend
--   1) public.pagamentos_v2.status = 'CANCELADO'
--   2) public.propostas.status_interno = 'NOVO'
-- O passo 2 e obrigatorio porque a trigger trg_sync_status_proposta
-- (public.atualizar_status_financeiro_proposta) grava CANCELADO na proposta
-- quando todas as cobrancas dela ficam CANCELADO. Sendo duas chamadas HTTP,
-- uma falha entre elas deixava a cobranca cancelada e a proposta CANCELADA —
-- estado parcial. Sem gate de status, a reversao para NOVO tambem podia
-- atropelar uma proposta ja em etapa produtiva.
--
-- Esta funcao executa os dois passos no corpo de uma unica funcao plpgsql,
-- portanto numa unica transacao: qualquer RAISE desfaz as duas escritas.
--
-- A trigger atualizar_status_financeiro_proposta NAO e alterada — continua
-- gravando CANCELADO durante o passo 1; o passo 2 corrige em seguida, dentro
-- da mesma transacao. Nenhuma outra trigger e criada ou modificada.
--
-- Seguranca: SECURITY INVOKER (padrao). A RLS de public.pagamentos_v2 e
-- public.propostas continua sendo avaliada com o papel de quem chama, igual
-- ao que o frontend ja fazia com os dois updates diretos. A funcao nao concede
-- nenhum poder novo: apenas torna a operacao atomica e a submete ao gate de
-- status. Nenhuma politica de RLS e criada ou alterada; a permissao de acionar
-- a acao continua no gate de UI (cobrancas.aprovar / admin).
--
-- Escopo: exclusivo da reprovacao de condicao. Nao substitui e nao e usada por
-- nenhum outro cancelamento de cobranca (cancelar-externo, cancelar-boleto,
-- CancelCobrancaModal seguem intactos).
-- ============================================================================

create or replace function public.cobranca_reprovar_condicao(
  p_id_pagamento uuid,
  p_motivo       text
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $func$
declare
  -- Espelha PROPOSTA_STATUS_PROTEGIDOS em
  -- src/features/orcamentos/services/status-protegidos.ts: etapas com vinculo
  -- operacional ativo (arte aprovada, producao, expedicao, entrega). Reprovar
  -- a condicao NAO pode devolver essas propostas para NOVO.
  c_protegidos constant text[] := array[
    'APROVADO', 'APROVADO / EM ARTE',
    'LIBERADO', 'LIBERADO / EM ARTE',
    'REVISAO ATENDENTE', 'REVISAO PRODUCAO',
    'EM PRODUCAO',
    'EM IMPRESSAO', 'EM IMPRESSAO / PENDENTE',
    'EM ACABAMENTO', 'EM ACABAMENTO / PENDENTE',
    'EXPEDICAO', 'A RETIRAR', 'EM TRANSITO', 'ENTREGUE'
  ];

  -- Status que podem legitimamente estar em conferencia de pagamento: os grupos
  -- "Comercial inicial" e "Financeiro pendente" de
  -- docs/business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md (secao 4) — tudo antes da
  -- liberacao. Qualquer outro valor (legado, desconhecido ou CANCELADO) e
  -- recusado em vez de convertido para NOVO, conforme a secao 3 do mesmo
  -- documento ("status desconhecido nao deve ser convertido automaticamente").
  c_permitidos constant text[] := array[
    'NOVO', 'NOVO / EM ARTE',
    'AGUARDANDO', 'AGUARDANDO / EM ARTE', 'AGUARDANDO / PENDENTE'
  ];

  v_motivo       text;
  v_pag          record;
  v_status_pag   text;
  v_id_int       bigint;
  v_status_prop  text;
  v_obs          text;
  v_conf_prop    text;
  v_conf_pag     text;
begin
  v_motivo := btrim(coalesce(p_motivo, ''));
  if v_motivo = '' then
    raise exception 'REPROVA: motivo da reprovacao e obrigatorio'
      using errcode = '22023';
  end if;

  -- Trava a cobranca: serializa cliques concorrentes sobre a mesma linha, para
  -- que a segunda chamada leia o status ja cancelado e caia na idempotencia.
  select id, id_int, status, confirmado, obs_v2
    into v_pag
    from public.pagamentos_v2
   where id = p_id_pagamento
   for update;

  if not found then
    raise exception 'REPROVA: cobranca % nao encontrada', p_id_pagamento
      using errcode = 'P0002';
  end if;

  v_status_pag := upper(coalesce(v_pag.status, ''));

  -- Idempotencia: cobranca ja cancelada e no-op. Devolve already_cancelled para
  -- o chamador NAO notificar o vendedor de novo.
  if v_status_pag in ('CANCELADO', 'CANCELADA') then
    return jsonb_build_object(
      'ok', true,
      'already_cancelled', true,
      'id_int', v_pag.id_int,
      'pagamento_status', v_pag.status,
      'proposta_status', (
        select status_interno from public.propostas where id_int = v_pag.id_int
      )
    );
  end if;

  -- Fora do escopo da reprovacao de condicao: cobranca paga ou com faturamento
  -- ja confirmado segue os fluxos proprios de cancelamento/estorno.
  if v_status_pag = 'PAID' or coalesce(v_pag.confirmado, false) then
    raise exception 'REPROVA: cobranca paga ou confirmada nao pode ser reprovada'
      using errcode = 'P0001';
  end if;

  if v_pag.id_int is null then
    raise exception 'REPROVA: cobranca % nao esta vinculada a uma proposta', p_id_pagamento
      using errcode = 'P0001';
  end if;
  v_id_int := v_pag.id_int;

  -- Trava e le a proposta ANTES de qualquer escrita: o gate de status precisa
  -- avaliar o estado real de origem, nao o CANCELADO que a trigger grava depois.
  select upper(btrim(coalesce(status_interno, '')))
    into v_status_prop
    from public.propostas
   where id_int = v_id_int
   for update;

  if not found then
    raise exception 'REPROVA: proposta #% nao encontrada', v_id_int
      using errcode = 'P0002';
  end if;

  if v_status_prop = any (c_protegidos) then
    raise exception 'REPROVA_STATUS_PROTEGIDO: proposta #% esta em [%] e nao pode voltar para NOVO. Resolva o vinculo produtivo antes de reprovar a condicao.',
      v_id_int, v_status_prop
      using errcode = 'P0001';
  end if;

  if not (v_status_prop = any (c_permitidos)) then
    raise exception 'REPROVA_STATUS_INESPERADO: proposta #% esta em [%], fora dos status que podem estar em conferencia de pagamento (%).',
      v_id_int, v_status_prop, array_to_string(c_permitidos, ', ')
      using errcode = 'P0001';
  end if;

  -- Passo 1: cobranca reprovada. Preserva o motivo em motivo_cancela e o
  -- historico anterior de obs_v2, no mesmo formato que o frontend usava.
  v_obs := case
             when coalesce(btrim(v_pag.obs_v2), '') = '' then ''
             else v_pag.obs_v2 || ' | '
           end
           || '[Reprovado em '
           || to_char((now() at time zone 'America/Sao_Paulo')::date, 'DD/MM/YYYY')
           || '] '
           || v_motivo;

  update public.pagamentos_v2
     set status         = 'CANCELADO',
         motivo_cancela = v_motivo,
         obs_v2         = v_obs
   where id = p_id_pagamento;

  -- Passo 2: proposta volta para NOVO. Depois do passo 1 de proposito — a
  -- trigger trg_sync_status_proposta acabou de gravar CANCELADO ali.
  update public.propostas
     set status_interno = 'NOVO'
   where id_int = v_id_int;

  -- Leitura confirmatoria dos dois lados. Divergencia derruba a transacao
  -- inteira: nunca um lado sem o outro.
  select upper(btrim(coalesce(status_interno, ''))) into v_conf_prop
    from public.propostas where id_int = v_id_int;

  if v_conf_prop <> 'NOVO' then
    raise exception 'REPROVA: proposta #% nao voltou para NOVO (banco retornou [%])',
      v_id_int, v_conf_prop
      using errcode = 'P0001';
  end if;

  select upper(coalesce(status, '')) into v_conf_pag
    from public.pagamentos_v2 where id = p_id_pagamento;

  if v_conf_pag <> 'CANCELADO' then
    raise exception 'REPROVA: cobranca % nao ficou CANCELADO (banco retornou [%])',
      p_id_pagamento, v_conf_pag
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_cancelled', false,
    'id_int', v_id_int,
    'pagamento_status', 'CANCELADO',
    'proposta_status', 'NOVO',
    'proposta_status_anterior', v_status_prop,
    'motivo', v_motivo,
    'obs_v2', v_obs
  );
end;
$func$;

comment on function public.cobranca_reprovar_condicao(uuid, text) is
  'Reprova a condicao de pagamento de uma cobranca em conferencia: cancela a cobranca em pagamentos_v2 e devolve propostas.status_interno para NOVO na mesma transacao. Recusa propostas em status operacional protegido. Idempotente para cobranca ja cancelada.';

-- Acionada pela aplicacao autenticada (Conferencia de Pagamentos). anon nao
-- participa deste fluxo.
revoke execute on function public.cobranca_reprovar_condicao(uuid, text) from public, anon;
grant  execute on function public.cobranca_reprovar_condicao(uuid, text) to authenticated;
