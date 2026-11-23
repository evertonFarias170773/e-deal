-- ============================================================================
-- Troca de forma de pagamento: Chave Pix com BOLETO À VISTA de origem
-- 23/11/2026 — pedido do Everton (caso 25255). NÃO APLICADA: DDL só com
-- autorização nominal.
--
-- A rota trocar-forma-pagamento passou a aceitar como origem um boleto à vista
-- não pago, de título único, emitido no C6 (Ideal, E3 e Birô no C6), nas
-- empresas em que o cancelamento do boleto confere o banco. Para Faturado,
-- E-Permuta, E-Amostra, E-Retrabalho e E-Crédito nada no banco muda. A Chave
-- Pix nasce por esta função, que hoje recusa origem que não seja PIX
-- ('CHAVE_ORIGEM: a cobrança ... não é PIX'). Enquanto esta migration não for
-- aplicada, a troca boleto -> Chave Pix é recusada com essa mensagem, sem
-- gravar nada e sem ir ao banco emissor (a marca da troca é solta).
--
-- O QUE MUDA (só o passo 3, a origem):
--   - tipo da origem: 'PIX' ou 'BOLETO';
--   - BOLETO: código do C6 gravado (sem hífen: UUID é do Inter) e exatamente um
--     título ativo em boletos para ele (mesmo id_boleto_c6 e pedido), parcela
--     1 de 1, boleto (não depósito) e não pago;
--   - mensagens dizem "a cobrança" em vez de "o PIX".
-- Corpo de partida: o VIVO em 23/11/2026 (20261117b, identificação opcional;
-- md5(prosrc) 17f16faf8b1e836a7dc9575292e9eb16). Resto idêntico.
-- Assinatura igual: CREATE OR REPLACE preserva o EXECUTE (authenticated,
-- service_role, postgres; sem anon).
-- ============================================================================

create or replace function public.fin_troca_criar_chave_pix(
  p_id_origem uuid,
  p_data_pagamento date,
  p_e2e_id text,
  p_comprovante text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_e2e text := nullif(upper(regexp_replace(coalesce(p_e2e_id, ''), '\s', '', 'g')), '');
  v_comprovante text := nullif(btrim(coalesce(p_comprovante, '')), '');
  v_nome text;
  v_autor text;
  v_origem public.pagamentos_v2%rowtype;
  v_tipo_origem text;
  v_cod text;
  v_titulos int;
  v_titulos_ok int;
  v_ref_origem text;
  v_dup text;
  v_paid_at timestamptz;
  v_nova_id uuid;
  v_nova_ref text;
begin
  -- 1. Quem: quem confirma pagamento na Conferência.
  perform public.cc__assert_permissao(v_uid, 'conferencia.confirm');
  select nome_usuario into v_nome from public.usuarios where user_id = v_uid;
  v_autor := coalesce(nullif(btrim(v_nome), ''), 'Usuário');

  -- 2. Forma dos dados.
  if p_id_origem is null then
    raise exception 'CHAVE_PARAMS: cobrança não informada';
  end if;
  if v_motivo = '' then
    raise exception 'CHAVE_PARAMS: informe o motivo da troca';
  end if;
  if p_data_pagamento is null then
    raise exception 'CHAVE_PARAMS: informe a data do pagamento';
  end if;
  if p_data_pagamento > v_hoje then
    raise exception 'CHAVE_DATA: a data do pagamento não pode ser futura';
  end if;
  if v_e2e is not null and v_e2e !~ '^[A-Z0-9]{32}$' then
    raise exception 'CHAVE_E2E: o e2eId tem 32 letras e números, sem espaços';
  end if;

  -- 3. A cobrança de origem, travada até o fim: PIX, ou boleto à vista no C6 (23/11/2026).
  select * into v_origem from public.pagamentos_v2 where id = p_id_origem for update;
  if not found then
    raise exception 'CHAVE_NAO_ENCONTRADA: cobrança não encontrada';
  end if;
  v_ref_origem := coalesce(v_origem.id_pagamento, v_origem.id::text);
  v_tipo_origem := upper(btrim(coalesce(v_origem.tipo_cobranca, '')));
  if v_tipo_origem not in ('PIX', 'BOLETO') then
    raise exception 'CHAVE_ORIGEM: a cobrança % não é PIX nem boleto à vista', v_ref_origem;
  end if;
  if upper(coalesce(v_origem.status, '')) <> 'A_RECEBER' or v_origem.paid_at is not null then
    raise exception 'CHAVE_ORIGEM: a cobrança % não está emitida e em aberto (status %)', v_ref_origem, coalesce(v_origem.status, 'vazio');
  end if;
  if v_origem.id_int is null then
    raise exception 'CHAVE_ORIGEM: a cobrança % não está ligada a um pedido', v_ref_origem;
  end if;
  if v_tipo_origem = 'BOLETO' then
    v_cod := nullif(btrim(coalesce(v_origem.cod_solicitacao_inter, '')), '');
    if v_cod is null or position('-' in v_cod) > 0 then
      raise exception 'CHAVE_ORIGEM: o boleto % não foi emitido no C6', v_ref_origem;
    end if;
    select count(*),
           count(*) filter (
             where coalesce(b.total_parcelas, 1) = 1
               and coalesce(b.deposito_conta, false) = false
               and b.paid_at is null
               and upper(coalesce(b.status, '')) <> 'PAID'
           )
      into v_titulos, v_titulos_ok
      from public.boletos b
     where b.id_boleto_c6 = v_cod
       and b.id_int = v_origem.id_int
       and upper(coalesce(b.status, '')) <> 'CANCELADO';
    if v_titulos <> 1 or v_titulos_ok <> 1 then
      raise exception 'CHAVE_ORIGEM: o boleto % não é à vista de título único em aberto (% título(s) ativo(s))', v_ref_origem, v_titulos;
    end if;
  end if;
  if coalesce(v_origem.motivo_troca, '') not like 'TROCA EM ANDAMENTO%' then
    raise exception 'CHAVE_SEM_TROCA: a Chave Pix só é registrada pela troca de forma de pagamento';
  end if;

  -- 4. Sem gravar em dobro.
  if exists (
    select 1 from public.recebimentos_chave_pix r
      join public.pagamentos_v2 p on p.id = r.id_pagamento
     where r.id_pagamento_origem = v_origem.id
       and upper(coalesce(p.status, '')) <> 'CANCELADO'
  ) then
    raise exception 'CHAVE_JA_REGISTRADA: a cobrança % já tem uma cobrança Chave Pix ativa', v_ref_origem;
  end if;

  if v_e2e is not null then
    perform pg_advisory_xact_lock(hashtext('chave_pix:e2e:' || v_e2e));
    select coalesce(p.id_pagamento, p.id::text) into v_dup
      from public.recebimentos_chave_pix r
      join public.pagamentos_v2 p on p.id = r.id_pagamento
     where r.e2e_id = v_e2e and upper(coalesce(p.status, '')) <> 'CANCELADO'
     limit 1;
    if v_dup is not null then
      raise exception 'CHAVE_DUPLICADA: este e2eId já foi registrado na cobrança %', v_dup;
    end if;
  end if;
  if v_comprovante is not null then
    perform pg_advisory_xact_lock(hashtext('chave_pix:comp:' || upper(v_comprovante)));
    select coalesce(p.id_pagamento, p.id::text) into v_dup
      from public.recebimentos_chave_pix r
      join public.pagamentos_v2 p on p.id = r.id_pagamento
     where upper(btrim(coalesce(r.comprovante, ''))) = upper(v_comprovante)
       and upper(coalesce(p.status, '')) <> 'CANCELADO'
     limit 1;
    if v_dup is not null then
      raise exception 'CHAVE_DUPLICADA: este comprovante já foi registrado na cobrança %', v_dup;
    end if;
  end if;

  -- 5. A cobrança nova: mesmo pedido, valor e pagador; PIX pago na chave.
  --    Hora do pagamento: agora, se foi hoje; senão meio-dia do dia informado.
  v_paid_at := case
    when p_data_pagamento = v_hoje then now()
    else (p_data_pagamento::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'
  end;

  insert into public.pagamentos_v2 (
    id_int, id_cliente, cliente, documento, valor, status, tipo_cobranca,
    empresa, id_empresa, os_ideal, atendente, descricao, vencimento, obs_v2,
    confirmado, forma_fatu, forma_pgto, id_modelo_cobranca,
    p_valor_entrada, p_qtd_parcelas, p_dias_pra_inicio, p_intervalo, paid_at
  ) values (
    v_origem.id_int, v_origem.id_cliente, v_origem.cliente, v_origem.documento,
    round(v_origem.valor::numeric, 2), 'PAID', 'PIX',
    v_origem.empresa, v_origem.id_empresa, v_origem.os_ideal, v_origem.atendente,
    format('Cobrança PIX (chave Pix) da proposta #%s (troca da %s)', v_origem.id_int, v_ref_origem),
    v_hoje, v_origem.obs_v2,
    false, null, 'CHAVE PIX', null,
    null, null, null, null, v_paid_at
  ) returning id, id_pagamento into v_nova_id, v_nova_ref;

  insert into public.recebimentos_chave_pix (
    id_pagamento, id_pagamento_origem, id_int, id_cliente, valor, data_pagamento,
    e2e_id, comprovante, motivo, registrado_por, registrado_por_nome
  ) values (
    v_nova_id, v_origem.id, v_origem.id_int, v_origem.id_cliente, round(v_origem.valor::numeric, 2),
    p_data_pagamento, v_e2e, v_comprovante, v_motivo, v_uid, v_autor
  );

  return jsonb_build_object('id', v_nova_id, 'id_pagamento', v_nova_ref);
end;
$function$;

comment on function public.fin_troca_criar_chave_pix(uuid, date, text, text, text) is
  'Troca de forma de pagamento para Chave Pix: cria a cobrança PIX já paga (forma_pgto CHAVE PIX) e o registro em recebimentos_chave_pix, numa transação. Origem: PIX, ou boleto à vista no C6 de título único (23/11/2026). Só quem confirma pagamento (conferencia.confirm); exige a troca em andamento; sem e2eId/comprovante repetido em cobrança ativa.';

-- Conferência depois de aplicar:
--   select md5(prosrc) from pg_proc where proname = 'fin_troca_criar_chave_pix';
--   select array_agg(a.grantee::regrole::text order by 1) from pg_proc p, aclexplode(p.proacl) a
--    where p.oid = 'public.fin_troca_criar_chave_pix(uuid,date,text,text,text)'::regprocedure
--      and a.privilege_type = 'EXECUTE';   -- esperado: {authenticated,postgres,service_role}
--
-- ROLLBACK: reaplicar o corpo de 20261117b_chave_pix_identificacao_opcional.sql.
