-- Pedido complementar, Etapa E2 — RPC `criar_pedido_complementar`
--
-- Plano: docs/superpowers/plans/2026-09-13-pedido-complementar.md (secao 4.1)
-- Regra: docs/business/PEDIDO-COMPLEMENTAR.md (secoes 4 e 5)
-- Depende de: 20260914_pedido_complementar_vinculo_e_ledger.sql (E1)
--
-- O QUE E
--   Uma funcao SECURITY DEFINER que cria, a partir de uma proposta PAGA e ainda
--   NAO EXPEDIDA, o cabecalho de um PEDIDO COMPLEMENTAR do mesmo evento: uma
--   linha nova em `propostas`, SEM itens, herdando cliente, endereco, contato,
--   pagador, modalidade e transportadora, com
--   `id_int_pedido_principal = <original>`. Devolve o `id_int` criado.
--
-- POR QUE UMA RPC, E NAO UM INSERT DO BROWSER
--   Os sete gates precisam ser lidos do banco dentro da mesma transacao do
--   INSERT. Gate que confia no chamador nao e gate. O `FOR UPDATE` na origem
--   serializa duas criacoes simultaneas para o mesmo original, e o gate 7 ve o
--   complemento que a outra acabou de criar.
--
-- OS GATES, NESTA ORDEM (o primeiro que falhar levanta a excecao)
--   1. permissao `propostas.complementar`, por `cc__assert_permissao`
--      ATENCAO: essa funcao aprova super administrador, perfil com '*' ou com a
--      chave, E TAMBEM qualquer usuario com `usuarios.is_admin = true`, mesmo
--      que o perfil nao tenha a chave (fallback ja existente). Medido em
--      13/09/2026: 2 usuarios passam so por esse fallback, ambos do perfil
--      Administrador — que recebe a permissao na E10 (decisao 10).
--   2. a origem existe (`COMPL_ORIGEM`)
--   3. a origem nao e avulsa (`COMPL_AVULSA`)
--   4. a origem nao e ela mesma um complemento (`COMPL_ENCADEADO`)
--   5. paga integralmente: `valor_total > 0` e `cc__valor_pago >= round(valor_total,2)`
--      (`COMPL_NAO_PAGA`, com os dois numeros na mensagem)
--   6. nao expedida, regra composta:
--      status entre LIBERADO e EXPEDICAO (`COMPL_STATUS`) e
--      nenhuma `expedicoes.data_despacho` preenchida (`COMPL_EXPEDIDA`)
--   7. sem complemento aberto — nao cancelado (`COMPL_JA_EXISTE`)
--
-- O INSERT (lista explicita, nunca `select *`)
--   HERDA: user_id, cliente, id_cliente, "cnpjCpf", proposta, prop_reduz,
--     id_conversa, empresa, vendedor, id_vendedor, contato, id_contato,
--     id_endereco_ent, cep, id_faturado, modalidade_frete,
--     id_transportadora_cliente, transporte_categoria, categoria_frete,
--     frete_escolhido, tipo_cob_edeal, tipo_boleto_edeal, tem_veppo,
--     obs_proposta.
--   FORCA: status_interno 'NOVO'; valor, valor_frete e valor_total 0; volume e
--     peso nulos; is_prd_aprovado, is_copia, is_avulso, libera_nf, em_arte,
--     conferencia, credito_processado e is_reproved false; boleto_aproved true;
--     motivo_reproved ''; id_int_origem_copia nulo; id_int_pedido_principal =
--     origem; obs_tecnica, json_produtos, texto_whatsapp, "PDF", id_frete,
--     id_cupincha, encerrado_teste_em, encerrado_teste_por e
--     liberado_producao_em nulos.
--   DEFAULTS DA TABELA: status_pedido, etapa_operacional,
--     prioridade_operacional, prazo_operacional, obs_pedido, created_at,
--     updated_at, conferido_por.
--   No INSERT disparam so `tg_propostas_valor_total_avulsa` (retorna na hora
--   para nao-avulsa) e `trg_audit_propostas`.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO copia produtos_proposta, variacoes, desconto_proposta, cotacao_frete,
--   pedidos_modelos, pedidos_artes (decisao 8: o complemento passa por arte),
--   pagamentos_v2, boletos, expedicoes, propostas_os, notas_fiscais nem chat.
--   NAO toca `cotacao_frete` de ninguem nem os tres triggers dela.
--   NAO usa `is_copia`, `id_int_origem_copia` nem `copiar_proposta_v2`.
--   NAO altera trigger, funcao existente, view, RLS nem o ACL de
--   `complementos_frete`. NAO escreve em `complementos_frete`.
--   NAO grava as mensagens de chat: isso e do service, na E3.
--   NAO concede `propostas.complementar` a perfil nenhum (E10).
--
-- VERIFICACAO (rodar depois de aplicar)
--
-- a) Funcao:
--    SELECT prosecdef, proconfig, pg_get_function_result(oid)
--      FROM pg_proc WHERE proname = 'criar_pedido_complementar';
--    Esperado: true; {search_path=public, pg_temp}; bigint.
--
-- b) Quem executa:
--    SELECT r.rolname, has_function_privilege(r.oid, 'public.criar_pedido_complementar(bigint)', 'EXECUTE')
--      FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
--    Esperado: anon false; authenticated true.
--
-- c) Gates, chamando pela API com o JWT de um usuario real (auth.uid()
--    precisa estar preenchido): ver a validacao da E2 no plano.
--
-- d) Triggers de `cotacao_frete` e `propostas` inalterados: comparar
--    md5(pg_get_triggerdef) e md5(pg_get_functiondef) com o retrato de antes.
--
-- ROLLBACK
--   DROP FUNCTION public.criar_pedido_complementar(bigint);
--   Nao desfaz complementos ja criados: eles continuam em `propostas` com
--   `id_int_pedido_principal` preenchido.

create or replace function public.criar_pedido_complementar(p_id_int_origem bigint)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_orig   public.propostas%rowtype;
  v_pago   numeric;
  v_aberto bigint;
  v_novo   bigint;
begin
  -- 1. permissao
  perform public.cc__assert_permissao(v_uid, 'propostas.complementar');

  -- 2. origem existe; o lock serializa duas criacoes simultaneas do mesmo original
  select * into v_orig from public.propostas where id_int = p_id_int_origem for update;
  if not found then
    raise exception 'COMPL_ORIGEM: proposta #% nao encontrada', p_id_int_origem;
  end if;

  -- 3. nao avulsa
  if coalesce(v_orig.is_avulso, false) then
    raise exception 'COMPL_AVULSA: a proposta #% e avulsa e nao aceita complemento', p_id_int_origem;
  end if;

  -- 4. nao e ela mesma um complemento (cadeia de um nivel so)
  if v_orig.id_int_pedido_principal is not null then
    raise exception 'COMPL_ENCADEADO: a proposta #% ja e complemento do #%; crie o complemento a partir do principal',
      p_id_int_origem, v_orig.id_int_pedido_principal;
  end if;

  -- 5. paga integralmente
  v_pago := coalesce(public.cc__valor_pago(p_id_int_origem), 0);
  if coalesce(v_orig.valor_total, 0) <= 0
     or round(v_pago, 2) < round(v_orig.valor_total::numeric, 2) then
    raise exception 'COMPL_NAO_PAGA: a proposta #% nao esta paga integralmente (pago R$ %, total R$ %)',
      p_id_int_origem, round(v_pago, 2), round(coalesce(v_orig.valor_total, 0)::numeric, 2);
  end if;

  -- 6. nao expedida (regra composta)
  if upper(coalesce(v_orig.status_interno, '')) not in (
       'LIBERADO', 'LIBERADO / EM ARTE', 'REVISAO ATENDENTE', 'REVISAO PRODUCAO', 'EM PRODUCAO',
       'EM IMPRESSAO', 'EM IMPRESSAO / PENDENTE', 'EM ACABAMENTO', 'EM ACABAMENTO / PENDENTE', 'EXPEDICAO')
  then
    raise exception 'COMPL_STATUS: a proposta #% esta em "%"; complemento so entre LIBERADO e EXPEDICAO',
      p_id_int_origem, coalesce(v_orig.status_interno, '(sem status)');
  end if;

  if exists (
    select 1 from public.expedicoes e
     where e.id_int = p_id_int_origem and e.data_despacho is not null
  ) then
    raise exception 'COMPL_EXPEDIDA: a proposta #% ja tem despacho registrado (expedicoes.data_despacho) e nao aceita complemento',
      p_id_int_origem;
  end if;

  -- 7. sem complemento aberto
  select min(c.id_int) into v_aberto
    from public.propostas c
   where c.id_int_pedido_principal = p_id_int_origem
     and upper(coalesce(c.status_interno, '')) <> 'CANCELADO';
  if v_aberto is not null then
    raise exception 'COMPL_JA_EXISTE: a proposta #% ja tem complemento aberto (#%)', p_id_int_origem, v_aberto;
  end if;

  -- 8. o cabecalho do complemento (lista explicita)
  insert into public.propostas (
    user_id, cliente, id_cliente, "cnpjCpf", proposta, prop_reduz, id_conversa,
    empresa, vendedor, id_vendedor,
    contato, id_contato, id_endereco_ent, cep, id_faturado,
    modalidade_frete, id_transportadora_cliente, transporte_categoria, categoria_frete, frete_escolhido,
    tipo_cob_edeal, tipo_boleto_edeal, tem_veppo, obs_proposta,
    status_interno, valor, valor_frete, valor_total, volume, peso,
    is_prd_aprovado, is_copia, id_int_origem_copia, id_int_pedido_principal,
    is_avulso, libera_nf, em_arte, conferencia, credito_processado,
    boleto_aproved, motivo_reproved, is_reproved,
    obs_tecnica, json_produtos, texto_whatsapp, "PDF", id_frete, id_cupincha,
    encerrado_teste_em, encerrado_teste_por, liberado_producao_em
  ) values (
    v_orig.user_id, v_orig.cliente, v_orig.id_cliente, v_orig."cnpjCpf", v_orig.proposta, v_orig.prop_reduz, v_orig.id_conversa,
    v_orig.empresa, v_orig.vendedor, v_orig.id_vendedor,
    v_orig.contato, v_orig.id_contato, v_orig.id_endereco_ent, v_orig.cep, v_orig.id_faturado,
    v_orig.modalidade_frete, v_orig.id_transportadora_cliente, v_orig.transporte_categoria, v_orig.categoria_frete, v_orig.frete_escolhido,
    v_orig.tipo_cob_edeal, v_orig.tipo_boleto_edeal, v_orig.tem_veppo, v_orig.obs_proposta,
    'NOVO', 0, 0, 0, null, null,
    false, false, null, p_id_int_origem,
    false, false, false, false, false,
    true, '', false,
    null, null, null, null, null, null,
    null, null, null
  )
  returning id_int into v_novo;

  return v_novo;
end;
$$;

revoke execute on function public.criar_pedido_complementar(bigint) from public;
grant execute on function public.criar_pedido_complementar(bigint) to authenticated;
