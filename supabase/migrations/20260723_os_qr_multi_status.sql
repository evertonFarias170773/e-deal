-- ============================================================================
-- 20260723_os_qr_multi_status.sql
--
-- AMPLIAÇÃO do fluxo público de status via QR de produção (v2).
-- Base: 20260722_os_qr_producao.sql + patches 20260723 (grants/digest).
--
-- ⚠️ MIGRATION VERSIONADA E **NÃO APLICADA**.
--    Não executar em produção sem autorização explícita.
--
-- Mudanças (FLUXO-OFICIAL-STATUS-PROPOSTAS.md v3.1 §3/§6/§13; Matriz seção QR):
--   - Novos status oficiais: 'EM IMPRESSAO / PENDENTE' e 'EM ACABAMENTO / PENDENTE'
--     (pausas laterais da etapa base, motivo obrigatório).
--   - A página /os passa a transitar entre os 9 status de produção/expedição:
--     EM PRODUCAO, EM IMPRESSAO, EM IMPRESSAO / PENDENTE, EM ACABAMENTO,
--     EM ACABAMENTO / PENDENTE, EXPEDICAO, A RETIRAR, EM TRANSITO, ENTREGUE.
--   - ENTREGUE é o ÚNICO terminal no QR (reabertura só pelo ERP).
--   - Próximo natural de EXPEDICAO definido pela cotação de frete escolhida
--     (cotacao_frete.escolhido=true): RETIRA/BALCAO → A RETIRAR; transporte →
--     EM TRANSITO; não informativo → nenhum natural (ambos disponíveis).
--   - Salto/retorno/pausa/lateral: motivo obrigatório VALIDADO NO SERVIDOR.
--   - Nova RPC os_qr_transicionar; os_qr_consultar reescrita (retorna destinos
--     classificados). os_qr_avancar (v1) permanece intocada durante a janela de
--     deploy e será removida em migration de limpeza posterior.
--   - Coluna aditiva os_status_log.tipo_transicao.
--
-- Lições aplicadas dos patches anteriores:
--   - digest sempre qualificado: extensions.digest (pgcrypto vive em extensions);
--   - unaccent qualificado: public.unaccent (instalado em public neste banco);
--   - REVOKE explícito de public/anon/authenticated em toda função nova
--     (default privileges do Supabase concedem EXECUTE direto aos papéis);
--   - ordem única de bloqueio: 1º propostas FOR UPDATE, 2º os_qr_tokens.
-- ============================================================================

-- ── Auditoria: coluna aditiva ────────────────────────────────────────────────

alter table public.os_status_log
  add column if not exists tipo_transicao text;

comment on column public.os_status_log.tipo_transicao is
  'Classificação da transição via QR v2: natural | retomada | pausa | avanco_entrega | lateral | retorno | salto. Null em registros da v1.';

-- ── Helpers da matriz (sem GRANT a papéis da app) ────────────────────────────

-- Os 9 status operáveis pelo QR (ordem de exibição da página pública).
create or replace function public.osqr__status_qr()
returns text[]
language sql immutable
as $$
  select array[
    'EM PRODUCAO',
    'EM IMPRESSAO',
    'EM IMPRESSAO / PENDENTE',
    'EM ACABAMENTO',
    'EM ACABAMENTO / PENDENTE',
    'EXPEDICAO',
    'A RETIRAR',
    'EM TRANSITO',
    'ENTREGUE'
  ];
$$;

-- Ordinal da cadeia (pendentes compartilham o ordinal da etapa base;
-- A RETIRAR e EM TRANSITO compartilham o ordinal de entrega).
create or replace function public.osqr__ordinal(p_status text)
returns int
language sql immutable
as $$
  select case p_status
    when 'EM PRODUCAO'             then 10
    when 'EM IMPRESSAO'            then 20
    when 'EM IMPRESSAO / PENDENTE' then 20
    when 'EM ACABAMENTO'           then 30
    when 'EM ACABAMENTO / PENDENTE' then 30
    when 'EXPEDICAO'               then 40
    when 'A RETIRAR'               then 50
    when 'EM TRANSITO'             then 50
    when 'ENTREGUE'                then 60
    else null
  end;
$$;

-- Forma de entrega da OS a partir da cotação escolhida.
-- Heurística documentada (FLUXO-OFICIAL §6.13): RETIRA/BALCAO → retirada;
-- serviço vazio, 'NAO', 'SEM CUSTO' ou sigla curta → indefinida; resto → transporte.
create or replace function public.osqr__forma_entrega(p_id_int bigint)
returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_servico text;
begin
  select upper(public.unaccent(trim(coalesce(servico, ''))))
    into v_servico
    from public.cotacao_frete
   where id_int = p_id_int
     and escolhido = true
   order by id desc
   limit 1;

  if not found or v_servico = '' then
    return 'indefinida';
  end if;

  if v_servico like '%RETIRA%' or v_servico like '%BALCAO%' then
    return 'retirada';
  end if;

  if v_servico in ('NAO', 'SEM CUSTO') or length(v_servico) < 3 then
    return 'indefinida';
  end if;

  return 'transporte';
end;
$$;

-- Classificação da transição p_de → p_para dada a forma de entrega.
-- Retorna jsonb { permitida, tipo, exige_motivo }.
-- A LISTA DE DESTINOS VÁLIDOS VIVE AQUI — o frontend nunca é confiado.
create or replace function public.osqr__classificar_transicao(p_de text, p_para text, p_forma text)
returns jsonb
language plpgsql immutable
as $$
declare
  v_ord_de int := public.osqr__ordinal(p_de);
  v_ord_para int := public.osqr__ordinal(p_para);
begin
  if v_ord_de is null or v_ord_para is null or p_para = p_de then
    return jsonb_build_object('permitida', false, 'tipo', null, 'exige_motivo', null);
  end if;

  -- Pausa: etapa base → seu / PENDENTE (motivo obrigatório).
  if (p_de = 'EM IMPRESSAO'  and p_para = 'EM IMPRESSAO / PENDENTE')
     or (p_de = 'EM ACABAMENTO' and p_para = 'EM ACABAMENTO / PENDENTE') then
    return jsonb_build_object('permitida', true, 'tipo', 'pausa', 'exige_motivo', true);
  end if;

  -- Retomada: / PENDENTE → etapa base (transição natural da pausa).
  if (p_de = 'EM IMPRESSAO / PENDENTE'  and p_para = 'EM IMPRESSAO')
     or (p_de = 'EM ACABAMENTO / PENDENTE' and p_para = 'EM ACABAMENTO') then
    return jsonb_build_object('permitida', true, 'tipo', 'retomada', 'exige_motivo', false);
  end if;

  -- Naturais lineares da produção.
  if (p_de = 'EM PRODUCAO'   and p_para = 'EM IMPRESSAO')
     or (p_de = 'EM IMPRESSAO'  and p_para = 'EM ACABAMENTO')
     or (p_de = 'EM ACABAMENTO' and p_para = 'EXPEDICAO') then
    return jsonb_build_object('permitida', true, 'tipo', 'natural', 'exige_motivo', false);
  end if;

  -- EXPEDICAO → entrega: natural conforme a forma registrada; contradição exige motivo;
  -- forma indefinida disponibiliza ambos sem natural (confirmação simples).
  if p_de = 'EXPEDICAO' and p_para in ('A RETIRAR', 'EM TRANSITO') then
    if (p_forma = 'retirada' and p_para = 'A RETIRAR')
       or (p_forma = 'transporte' and p_para = 'EM TRANSITO') then
      return jsonb_build_object('permitida', true, 'tipo', 'natural', 'exige_motivo', false);
    elsif p_forma = 'indefinida' then
      return jsonb_build_object('permitida', true, 'tipo', 'avanco_entrega', 'exige_motivo', false);
    else
      return jsonb_build_object('permitida', true, 'tipo', 'avanco_entrega', 'exige_motivo', true);
    end if;
  end if;

  -- Entrega → ENTREGUE: natural (a UI sempre aplica confirmação reforçada).
  if p_para = 'ENTREGUE' and p_de in ('A RETIRAR', 'EM TRANSITO') then
    return jsonb_build_object('permitida', true, 'tipo', 'natural', 'exige_motivo', false);
  end if;

  -- Lateral: troca do método de entrega já iniciado (motivo obrigatório).
  if (p_de = 'A RETIRAR' and p_para = 'EM TRANSITO')
     or (p_de = 'EM TRANSITO' and p_para = 'A RETIRAR') then
    return jsonb_build_object('permitida', true, 'tipo', 'lateral', 'exige_motivo', true);
  end if;

  -- Retorno: qualquer regressão na cadeia (motivo obrigatório).
  if v_ord_para < v_ord_de then
    return jsonb_build_object('permitida', true, 'tipo', 'retorno', 'exige_motivo', true);
  end if;

  -- Resto: salto (pular etapa, entrar/sair de pendente de outra etapa,
  -- EXPEDICAO → ENTREGUE etc.) — motivo obrigatório.
  return jsonb_build_object('permitida', true, 'tipo', 'salto', 'exige_motivo', true);
end;
$$;

-- Destinos classificados a partir de um status atual (para consulta e UI).
create or replace function public.osqr__destinos(p_status text, p_forma text)
returns jsonb
language plpgsql immutable
as $$
declare
  v_destino text;
  v_cls jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  foreach v_destino in array public.osqr__status_qr() loop
    if v_destino = p_status then
      continue;
    end if;
    v_cls := public.osqr__classificar_transicao(p_status, v_destino, p_forma);
    if (v_cls->>'permitida')::boolean then
      v_out := v_out || jsonb_build_object(
        'status', v_destino,
        'tipo', v_cls->>'tipo',
        'natural', (v_cls->>'tipo') in ('natural', 'retomada'),
        'exige_motivo', (v_cls->>'exige_motivo')::boolean
      );
    end if;
  end loop;
  return v_out;
end;
$$;

-- ── os_qr_consultar v2 (CREATE OR REPLACE preserva os grants aplicados) ──────

create or replace function public.os_qr_consultar(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_tok record;
  v_status text;
  v_forma text;
  v_destinos jsonb;
  v_proximo text;
  v_produto record;
  v_qtd_itens int;
  v_resumo text;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select id, id_int, revoked_at
    into v_tok
    from public.os_qr_tokens
   where token_hash = v_hash
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  if v_tok.revoked_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_REVOGADO');
  end if;

  select status_interno into v_status
    from public.propostas
   where id_int = v_tok.id_int
   limit 1;

  v_status := coalesce(trim(v_status), '');

  select nome_produto, qtd into v_produto
    from public.produtos_proposta
   where id_int = v_tok.id_int
   order by id
   limit 1;

  select count(*) into v_qtd_itens
    from public.produtos_proposta
   where id_int = v_tok.id_int;

  v_resumo := coalesce(v_produto.nome_produto, 'Produto');
  if coalesce(v_produto.qtd, 0) > 0 then
    v_resumo := v_resumo || ' — ' || v_produto.qtd::text || ' un';
  end if;
  if v_qtd_itens > 1 then
    v_resumo := v_resumo || ' (+' || (v_qtd_itens - 1)::text || ' itens)';
  end if;

  if v_status = 'CANCELADO' then
    return jsonb_build_object('ok', false, 'motivo', 'CANCELADA', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  -- v2: ENTREGUE é o único terminal do QR.
  if v_status = 'ENTREGUE' then
    return jsonb_build_object('ok', false, 'motivo', 'FINALIZADO', 'id_int', v_tok.id_int,
                              'produto_resumo', v_resumo, 'status_atual', v_status);
  end if;

  if v_status <> all (public.osqr__status_qr()) then
    return jsonb_build_object('ok', false, 'motivo', 'FORA_DO_FLUXO', 'id_int', v_tok.id_int,
                              'produto_resumo', v_resumo, 'status_atual', v_status);
  end if;

  v_forma := public.osqr__forma_entrega(v_tok.id_int);
  v_destinos := public.osqr__destinos(v_status, v_forma);

  -- Compat com o client v1 em cache durante a janela de deploy: primeiro natural (ou null).
  select d->>'status' into v_proximo
    from jsonb_array_elements(v_destinos) as d
   where (d->>'natural')::boolean
   limit 1;

  return jsonb_build_object('ok', true, 'id_int', v_tok.id_int, 'produto_resumo', v_resumo,
                            'status_atual', v_status, 'forma_entrega', v_forma,
                            'destinos', v_destinos, 'proximo_status', v_proximo);
end;
$$;

-- ── Nova RPC pública de escrita: transição livre validada no servidor ────────

create or replace function public.os_qr_transicionar(
  p_token text,
  p_status_atual_esperado text,
  p_status_destino text,
  p_motivo text default null,
  p_ip_hash text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_tok record;
  v_status text;
  v_destino text;
  v_forma text;
  v_cls jsonb;
  v_motivo text;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Passo 1: resolve o token SEM lock (apenas para descobrir a OS).
  select id, id_int, revoked_at
    into v_tok
    from public.os_qr_tokens
   where token_hash = v_hash
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  if v_tok.revoked_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_REVOGADO');
  end if;

  -- Passo 2: ORDEM ÚNICA DE BLOQUEIO — 1º proposta (âncora da OS)…
  select trim(coalesce(status_interno, '')) into v_status
    from public.propostas
   where id_int = v_tok.id_int
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  -- …2º linha do token (re-verifica revogação pós-lock e serializa rate limit).
  select id, id_int, revoked_at, rl_janela_inicio, rl_tentativas
    into v_tok
    from public.os_qr_tokens
   where token_hash = v_hash
     for update;

  if v_tok.revoked_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_REVOGADO');
  end if;

  -- Rate limit persistente por token: janela fixa 60s, máx. 10 tentativas.
  if v_tok.rl_janela_inicio is null or now() - v_tok.rl_janela_inicio > interval '60 seconds' then
    update public.os_qr_tokens
       set rl_janela_inicio = now(), rl_tentativas = 1
     where id = v_tok.id;
  else
    update public.os_qr_tokens
       set rl_tentativas = rl_tentativas + 1
     where id = v_tok.id;
    if v_tok.rl_tentativas + 1 > 10 then
      return jsonb_build_object('ok', false, 'motivo', 'RATE_LIMITED');
    end if;
  end if;

  -- Classificação do estado atual.
  if v_status = 'CANCELADO' then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'cancelada', 'OS cancelada', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'CANCELADA', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  -- v2: ENTREGUE é terminal — nenhuma transição posterior via QR.
  if v_status = 'ENTREGUE' then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'finalizado', 'Entrega concluída — fluxo encerrado', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'FINALIZADO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  if v_status <> all (public.osqr__status_qr()) then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'fora_do_fluxo', 'Status fora da matriz do QR', v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'FORA_DO_FLUXO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  -- Destino: nunca confiar na lista do frontend.
  v_destino := trim(coalesce(p_status_destino, ''));
  if v_destino = '' or v_destino = v_status or v_destino <> all (public.osqr__status_qr()) then
    return jsonb_build_object('ok', false, 'motivo', 'DESTINO_INVALIDO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  -- Checagem otimista: cobre duplo clique, duas abas e mudança interna concorrente.
  if v_status <> trim(coalesce(p_status_atual_esperado, '')) then
    insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, token_id, ip_hash, user_agent)
    values (v_tok.id_int, v_status, null, 'conflito',
            'Esperado [' || coalesce(p_status_atual_esperado, '') || '], atual [' || v_status || ']',
            v_tok.id, p_ip_hash, left(p_user_agent, 200));
    return jsonb_build_object('ok', false, 'motivo', 'CONFLITO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  v_forma := public.osqr__forma_entrega(v_tok.id_int);
  v_cls := public.osqr__classificar_transicao(v_status, v_destino, v_forma);

  if not (v_cls->>'permitida')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'DESTINO_INVALIDO', 'id_int', v_tok.id_int, 'status_atual', v_status);
  end if;

  v_motivo := nullif(left(trim(coalesce(p_motivo, '')), 300), '');
  if (v_cls->>'exige_motivo')::boolean and v_motivo is null then
    return jsonb_build_object('ok', false, 'motivo', 'MOTIVO_OBRIGATORIO', 'id_int', v_tok.id_int,
                              'status_atual', v_status, 'tipo_transicao', v_cls->>'tipo');
  end if;

  -- Transição atômica (linha já lockada).
  update public.propostas
     set status_interno = v_destino
   where id_int = v_tok.id_int;

  insert into public.os_status_log (id_int, status_anterior, status_novo, resultado, motivo, tipo_transicao, origem, ator_tipo, token_id, ip_hash, user_agent)
  values (v_tok.id_int, v_status, v_destino, 'sucesso', v_motivo, v_cls->>'tipo', 'qr_producao', 'qr_producao', v_tok.id, p_ip_hash, left(p_user_agent, 200));

  perform public.osqr__timeline(
    v_tok.id_int,
    'Status alterado de [' || v_status || '] para [' || v_destino || '] via QR Code de produção'
      || ' (' || (v_cls->>'tipo') || case when v_motivo is null then '' else '; motivo: ' || v_motivo end || ').'
  );

  update public.os_qr_tokens
     set last_used_at = now(), uso_count = uso_count + 1
   where id = v_tok.id;

  return jsonb_build_object('ok', true, 'id_int', v_tok.id_int,
                            'status_anterior', v_status, 'status_novo', v_destino,
                            'tipo_transicao', v_cls->>'tipo',
                            'finalizado', v_destino = 'ENTREGUE');
end;
$$;

-- ── Grants (REVOKE explícito por papel — default privileges do Supabase) ─────

revoke all on function public.osqr__status_qr() from public, anon, authenticated;
revoke all on function public.osqr__ordinal(text) from public, anon, authenticated;
revoke all on function public.osqr__forma_entrega(bigint) from public, anon, authenticated;
revoke all on function public.osqr__classificar_transicao(text, text, text) from public, anon, authenticated;
revoke all on function public.osqr__destinos(text, text) from public, anon, authenticated;

-- Reafirma o contrato da consulta (CREATE OR REPLACE preserva grants; explícito por clareza).
revoke all on function public.os_qr_consultar(text) from public;
grant execute on function public.os_qr_consultar(text) to anon, authenticated;

revoke all on function public.os_qr_transicionar(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.os_qr_transicionar(text, text, text, text, text, text) to anon, authenticated;
