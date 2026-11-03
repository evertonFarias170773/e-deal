-- ============================================================================
-- Natureza da operacao do 5202 / 6202: "Devolução de Compra"
-- ============================================================================
--
-- O QUE MUDA
--   So `natureza_curta` das linhas NFE de CFOP 5202 e 6202 em
--   `nfe_naturezas_operacao`: de nulo para 'Devolução de Compra'.
--   Com isso o natOp das NF-e NOVAS desses CFOPs passa de
--   "Devolução de compra para comercialização" (a descricao sem o prefixo)
--   para "Devolução de Compra", pedido do financeiro em 03/11/2026.
--
-- O QUE NAO MUDA
--   `descricao` (chave que casa notas_fiscais.drop_natureza_op com o catalogo),
--   CFOP, CST, tipo e destino da operacao, ativo, nenhuma outra linha e nenhuma
--   nota. Em 03/11/2026 nenhuma nota usa 5202 ou 6202.
--
-- QUEM LE natureza_curta (conferido em 03/11/2026)
--   fn_defaults_rascunho_nfe e fn_sync_natureza_operacao_nfe (montam o natOp),
--   nfe.service getNaturezasOperacaoNfe / rotuloDaNaturezaOperacao (rotulo do
--   seletor; o valor gravado segue sendo a descricao). Nenhum filtro, relatorio
--   ou fluxo do n8n usa o texto do 5202/6202.
--
-- A assercao 5.2 da migration 20260922 ("so linha que estoura ganha texto
-- curto") valia so para aquela rodada: aqui o texto curto e escolha do negocio,
-- nao limite de 60.
-- ============================================================================

do $migracao$
declare
  v_resto_antes   text;
  v_resto_depois  text;
  v_desc_antes    text;
  v_desc_depois   text;
  v_notas_antes   text;
  v_notas_depois  text;
  v_alvo          int;
  v_feitas        int;
begin
  -- O que NAO pode mudar: todas as outras linhas, inteiras.
  select md5(coalesce(string_agg(row_to_json(n)::text, ',' order by n.id), '')) into v_resto_antes
    from public.nfe_naturezas_operacao n
   where not (n.modelo_fiscal = 'NFE' and n.cfop in ('5202', '6202'));

  -- E nas duas linhas, tudo menos natureza_curta e updated_at.
  select md5(coalesce(string_agg(n.id || '|' || n.cfop || '|' || n.descricao || '|' || coalesce(n.tipo_operacao,'') || '|'
              || coalesce(n.destino_operacao,'') || '|' || coalesce(n.icms_situacao_tributaria,'') || '|'
              || coalesce(n.pis_situacao_tributaria,'') || '|' || coalesce(n.cofins_situacao_tributaria,'') || '|'
              || n.ativo::text, ',' order by n.id), '')) into v_desc_antes
    from public.nfe_naturezas_operacao n
   where n.modelo_fiscal = 'NFE' and n.cfop in ('5202', '6202');

  select count(*)::text || '|' || coalesce(max(updated_at)::text, '') into v_notas_antes
    from public.notas_fiscais;

  select count(*) into v_alvo
    from public.nfe_naturezas_operacao n
   where n.modelo_fiscal = 'NFE' and n.cfop in ('5202', '6202');

  update public.nfe_naturezas_operacao
     set natureza_curta = 'Devolução de Compra', updated_at = now()
   where modelo_fiscal = 'NFE'
     and cfop in ('5202', '6202');
  get diagnostics v_feitas = row_count;

  if v_feitas <> v_alvo or v_feitas not between 1 and 2 then
    raise exception 'esperado atualizar % linha(s) (5202/6202), atualizou %', v_alvo, v_feitas;
  end if;

  select md5(coalesce(string_agg(row_to_json(n)::text, ',' order by n.id), '')) into v_resto_depois
    from public.nfe_naturezas_operacao n
   where not (n.modelo_fiscal = 'NFE' and n.cfop in ('5202', '6202'));
  if v_resto_depois is distinct from v_resto_antes then
    raise exception 'outra linha do catalogo mudou';
  end if;

  select md5(coalesce(string_agg(n.id || '|' || n.cfop || '|' || n.descricao || '|' || coalesce(n.tipo_operacao,'') || '|'
              || coalesce(n.destino_operacao,'') || '|' || coalesce(n.icms_situacao_tributaria,'') || '|'
              || coalesce(n.pis_situacao_tributaria,'') || '|' || coalesce(n.cofins_situacao_tributaria,'') || '|'
              || n.ativo::text, ',' order by n.id), '')) into v_desc_depois
    from public.nfe_naturezas_operacao n
   where n.modelo_fiscal = 'NFE' and n.cfop in ('5202', '6202');
  if v_desc_depois is distinct from v_desc_antes then
    raise exception 'descricao, CST ou tipo do 5202/6202 mudou';
  end if;

  select count(*)::text || '|' || coalesce(max(updated_at)::text, '') into v_notas_depois
    from public.notas_fiscais;
  if v_notas_depois is distinct from v_notas_antes then
    raise exception 'notas_fiscais mudou';
  end if;
end
$migracao$;

-- ============================================================================
-- VERIFICACAO
--   select cfop, descricao, natureza_curta from public.nfe_naturezas_operacao
--    where modelo_fiscal = 'NFE' and cfop in ('5202', '6202') order by cfop;
--   -- esperado: 2 linhas, descricao "NNNN - Devolução de compra para
--   -- comercialização" intacta, natureza_curta "Devolução de Compra".
--
-- ROLLBACK
--   update public.nfe_naturezas_operacao
--      set natureza_curta = null, updated_at = now()
--    where modelo_fiscal = 'NFE' and cfop in ('5202', '6202');
-- ============================================================================
