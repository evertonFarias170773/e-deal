-- ============================================================================
-- Frete complementar aceita NOVO_ARTE_APROVADA e AGUARDANDO_ARTE_APROVADA
-- 28/09/2026, decisao do dono — autorizacao nominal SO para esta migration.
--
-- POR QUE
--   Os dois valores sao gravados pelo motor de status do Vibe
--   (status-engine.service.ts) quando todas as artes estao aprovadas antes do
--   pagamento. Sao NOVO e AGUARDANDO com a arte aprovada: o sufixo
--   "_ARTE_APROVADA" tem o mesmo tratamento de " / EM ARTE". O passo 7 desta
--   funcao so aceitava NOVO e AGUARDANDO e recusava um complemento nesses dois
--   status com COMPL_FRETE_STATUS.
--
-- O QUE MUDA
--   Somente a lista do passo 7 ganha os dois valores. O resto do corpo e o
--   corpo VIVO, conferido antes pelo md5 de prosrc:
--     antes  7eb9663d2c4c72b67a437f42643d049d (igual ao de 20260915_complementar_aplicar_frete.sql)
--     depois bd6f6a4139c455b175edc545e4ce3b2f
--   A mensagem de erro do passo 7 nao muda. CREATE OR REPLACE mantem assinatura,
--   dono, ACL (authenticated e service_role com EXECUTE) e o comentario.
--
-- REVERTER
--   Reaplicar o corpo de 20260915_complementar_aplicar_frete.sql.
-- ============================================================================

create or replace function public.complementar_aplicar_frete(
  p_id_int_complemento      bigint,
  p_chave                   uuid,
  p_peso_original_gramas    integer,
  p_peso_origem_original    text,
  p_peso_complemento_gramas integer,
  p_frete_total_cotado      numeric,
  p_frete_cobrado_original  numeric,
  p_transportadora          text,
  p_servico                 text,
  p_prazo                   text,
  p_cep                     text,
  p_id_endereco_entrega     uuid,
  p_subtotal_original       numeric,
  p_subtotal_complemento    numeric,
  p_opcoes_cotadas          jsonb,
  p_autor_nome              text,
  p_autor_email             text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_exist        bigint;
  v_compl        public.propostas%rowtype;
  v_orig         public.propostas%rowtype;
  v_id_principal bigint;
  v_peso_banco   numeric;
  v_diferenca    numeric;
  v_cobrar       numeric;
  v_pago         numeric;
  v_new_id       bigint;
begin
  -- 0. permissao
  perform public.cc__assert_permissao(v_uid, 'propostas.complementar');

  -- 1. parametros
  if p_id_int_complemento is null or p_chave is null
     or p_frete_total_cotado is null or p_frete_cobrado_original is null
     or p_peso_original_gramas is null or p_peso_complemento_gramas is null
     or coalesce(btrim(p_peso_origem_original), '') = ''
     or coalesce(btrim(p_transportadora), '') = ''
     or coalesce(btrim(p_servico), '') = ''
     or coalesce(btrim(p_cep), '') = '' then
    raise exception 'COMPL_FRETE_PARAMS: complemento, chave, pesos, origem do peso, valores, transportadora, servico e CEP sao obrigatorios';
  end if;
  if p_peso_original_gramas <= 0 or p_peso_complemento_gramas <= 0 then
    raise exception 'COMPL_FRETE_PARAMS: peso do principal (%) e do complemento (%) precisam ser maiores que zero',
      p_peso_original_gramas, p_peso_complemento_gramas;
  end if;
  if p_frete_total_cotado < 0 or p_frete_cobrado_original < 0 then
    raise exception 'COMPL_FRETE_PARAMS: frete cotado (R$ %) e frete do principal (R$ %) nao podem ser negativos',
      p_frete_total_cotado, p_frete_cobrado_original;
  end if;

  -- 2. idempotencia, antes de qualquer gate de negocio
  select id into v_exist from public.complementos_frete where chave = p_chave;
  if found then
    return v_exist;
  end if;

  -- 3. o complemento
  select * into v_compl from public.propostas where id_int = p_id_int_complemento for update;
  if not found then
    raise exception 'COMPL_FRETE_COMPLEMENTO: proposta #% nao encontrada', p_id_int_complemento;
  end if;

  -- 4. vinculo e principal
  v_id_principal := v_compl.id_int_pedido_principal;
  if v_id_principal is null then
    raise exception 'COMPL_FRETE_VINCULO: a proposta #% nao e um pedido complementar', p_id_int_complemento;
  end if;
  select * into v_orig from public.propostas where id_int = v_id_principal for update;
  if not found then
    raise exception 'COMPL_FRETE_PRINCIPAL: pedido principal #% nao encontrado', v_id_principal;
  end if;

  -- 5. nao avulsa
  if coalesce(v_compl.is_avulso, false) then
    raise exception 'COMPL_FRETE_AVULSA: a proposta #% e avulsa e nao tem itens para pesar', p_id_int_complemento;
  end if;

  -- 6. modalidade
  if upper(coalesce(btrim(v_compl.modalidade_frete), '')) <> 'CIF' then
    raise exception 'COMPL_FRETE_MODALIDADE: o pedido #% esta em % e nao cobra frete',
      p_id_int_complemento, coalesce(v_compl.modalidade_frete, 'modalidade nao declarada');
  end if;

  -- 7. status do complemento
  if upper(coalesce(btrim(v_compl.status_interno), '')) not in ('NOVO', 'AGUARDANDO', 'NOVO_ARTE_APROVADA', 'AGUARDANDO_ARTE_APROVADA') then
    raise exception 'COMPL_FRETE_STATUS: o frete complementar so entra em NOVO ou AGUARDANDO; o pedido #% esta em "%"',
      p_id_int_complemento, coalesce(v_compl.status_interno, '(sem status)');
  end if;

  -- 8. principal ainda nao expedido (regra composta)
  if upper(coalesce(v_orig.status_interno, '')) not in (
       'LIBERADO', 'LIBERADO / EM ARTE', 'REVISAO ATENDENTE', 'REVISAO PRODUCAO', 'EM PRODUCAO',
       'EM IMPRESSAO', 'EM IMPRESSAO / PENDENTE', 'EM ACABAMENTO', 'EM ACABAMENTO / PENDENTE', 'EXPEDICAO')
  then
    raise exception 'COMPL_FRETE_EXPEDIDO: o pedido #% esta em "%"; o frete complementar so entre LIBERADO e EXPEDICAO',
      v_id_principal, coalesce(v_orig.status_interno, '(sem status)');
  end if;
  if exists (
    select 1 from public.expedicoes e
     where e.id_int = v_id_principal and e.data_despacho is not null
  ) then
    raise exception 'COMPL_FRETE_EXPEDIDO: o pedido #% ja tem despacho registrado', v_id_principal;
  end if;

  -- 9. guarda otimista sobre o frete do principal
  if round(coalesce(v_orig.valor_frete, 0)::numeric, 2) <> round(p_frete_cobrado_original, 2) then
    raise exception 'COMPL_FRETE_CONCORRENCIA: o frete do pedido #% mudou (R$ % agora, R$ % na cotacao) - cote de novo',
      v_id_principal, round(coalesce(v_orig.valor_frete, 0)::numeric, 2), round(p_frete_cobrado_original, 2);
  end if;

  -- 10. peso do complemento, lido do banco
  select coalesce(sum(pp.peso_total), 0) into v_peso_banco
    from public.produtos_proposta pp
   where pp.id_int = p_id_int_complemento
     and upper(coalesce(pp.status_item, 'PENDENTE')) <> 'CANCELADO';
  if abs(v_peso_banco - p_peso_complemento_gramas) > 1 then
    raise exception 'COMPL_FRETE_PESO: os itens do pedido #% pesam % g agora, e a cotacao usou % g - cote de novo',
      p_id_int_complemento, round(v_peso_banco, 1), p_peso_complemento_gramas;
  end if;

  -- calculo, ponto unico
  v_diferenca := round(p_frete_total_cotado - p_frete_cobrado_original, 2);
  v_cobrar    := greatest(0, v_diferenca);
  v_pago      := coalesce(public.cc__valor_pago(v_id_principal), 0);

  -- o livro-razao, primeiro: ele e o registro de COMO o frete foi calculado
  insert into public.complementos_frete (
    id_int_complemento, id_int_principal, chave,
    autor_uid, autor_nome, autor_email,
    peso_original_gramas, peso_origem_original, peso_complemento_gramas, peso_somado_gramas,
    frete_total_cotado, frete_cobrado_original, diferenca, frete_cobrado_complemento,
    transportadora, servico, prazo, cep, id_endereco_entrega, modalidade,
    status_original_no_ato, status_complemento_no_ato, valor_pago_original,
    subtotal_itens_original, subtotal_itens_complemento, opcoes_cotadas
  ) values (
    p_id_int_complemento, v_id_principal, p_chave,
    v_uid, p_autor_nome, p_autor_email,
    p_peso_original_gramas, p_peso_origem_original, p_peso_complemento_gramas,
    p_peso_original_gramas + p_peso_complemento_gramas,
    round(p_frete_total_cotado, 2), round(p_frete_cobrado_original, 2), v_diferenca, round(v_cobrar, 2),
    p_transportadora, p_servico, p_prazo, p_cep, p_id_endereco_entrega, 'CIF',
    coalesce(v_orig.status_interno, '(sem status)'), coalesce(v_compl.status_interno, '(sem status)'),
    round(v_pago, 2),
    round(coalesce(p_subtotal_original, 0), 2), round(coalesce(p_subtotal_complemento, 0), 2),
    p_opcoes_cotadas
  )
  returning id into v_new_id;

  -- a cotacao, SO do complemento: peso DELE, valor A COBRAR
  delete from public.cotacao_frete where id_int = p_id_int_complemento;
  insert into public.cotacao_frete (id_int, servico, valor, prazo, cep, peso, escolhido)
  values (p_id_int_complemento, p_servico, round(v_cobrar, 2), p_prazo, p_cep, p_peso_complemento_gramas, true);

  -- `valor_frete` e o rotulo: o v3 nao escreve nenhum dos dois
  update public.propostas
     set valor_frete = round(v_cobrar, 2),
         frete_escolhido = p_servico
   where id_int = p_id_int_complemento;

  return v_new_id;
end;
$$;
