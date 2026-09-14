-- Pedido complementar, Etapa E6 — RPC `complementar_aplicar_frete`
--
-- Plano: docs/superpowers/plans/2026-09-13-pedido-complementar.md (secao 4.2)
-- Regra: docs/business/PEDIDO-COMPLEMENTAR.md (secoes 6 e 7)
-- Depende de: 20260914_pedido_complementar_vinculo_e_ledger.sql (E1),
--             20260914_criar_pedido_complementar.sql (E2)
--
-- O QUE E
--   A escrita do frete complementar, numa transacao so: grava a linha do
--   livro-razao `complementos_frete`, grava a cotacao DO COMPLEMENTO em
--   `cotacao_frete` e atualiza `propostas.valor_frete` e `frete_escolhido` DO
--   COMPLEMENTO. Devolve o `id` da linha do ledger.
--
-- POR QUE UMA RPC, E NAO TRES ESCRITAS DA ROTA
--   Ledger, cotacao e proposta precisam cair juntos ou nao cair. Pelo PostgREST
--   seriam tres chamadas soltas, e uma janela entre elas deixaria ledger sem
--   cotacao — exatamente o estado que ninguem sabe ler depois. Os gates tambem
--   precisam ser lidos sob `FOR UPDATE` na mesma transacao: gate que confia no
--   chamador nao e gate.
--
-- O ORIGINAL NAO E TOCADO — E ESSE E O PONTO
--   Nenhum INSERT, UPDATE ou DELETE em `cotacao_frete` do principal, e nenhum
--   UPDATE em `propostas` do principal. As unicas linhas de `cotacao_frete`
--   escritas tem `id_int = <complemento>`; os tres triggers da tabela sao FOR
--   EACH ROW e fazem `UPDATE propostas WHERE id_int = NEW/OLD.id_int`, entao
--   agem SO sobre o complemento:
--     - `trg_recalc_after_frete`  -> recalcular_proposta_v3  (valor, volume, valor_total)
--     - `trg_frete_sync_financeiro` -> atualizar_status_financeiro_proposta (status_interno)
--     - `tg_recalc_frete_v4` (no-op)
--   O efeito sobre o complemento e o normal de qualquer orcamento. O valor
--   `valor_frete` nao e escrito pelo v3 — por isso o UPDATE explicito no fim.
--
-- O QUE VAI PARA CADA LUGAR
--   `cotacao_frete` do complemento guarda o peso DO PROPRIO COMPLEMENTO e o
--   valor A COBRAR (a diferenca). E o que a guarda de frete desatualizado
--   compara (ela soma `produtos_proposta.peso_total` do MESMO `id_int`); gravar
--   o peso somado ali bloquearia a cobranca para sempre.
--   O peso somado, a cotacao do somado, o frete ja cobrado no principal e a
--   diferenca ficam no LEDGER, que e a unica memoria de como o frete
--   complementar foi calculado.
--
-- FRETE SOMADO MENOR QUE O JA COBRADO
--   `frete_cobrado_complemento = greatest(0, diferenca)` — cobra ZERO, e a
--   diferenca negativa fica so registrada. Nada e creditado e nada e escrito no
--   principal (decisao 2 do dono, 13/09/2026). O CHECK
--   `complementos_frete_cobrado_ck` guarda essa regra no banco.
--
-- OS GATES, NESTA ORDEM
--   0. permissao `propostas.complementar` (`cc__assert_permissao`)
--   1. parametros obrigatorios (`COMPL_FRETE_PARAMS`)
--   2. IDEMPOTENCIA por `chave`, antes de qualquer gate de negocio: a operacao
--      ja aconteceu e o estado atual pode reprovar num gate que ela mesma mudou
--      (mesmo padrao de `exp_aplicar_recotacao`). O unique(chave) segue como
--      rede para corrida.
--   3. complemento existe (`COMPL_FRETE_COMPLEMENTO`), sob `FOR UPDATE`
--   4. tem vinculo (`COMPL_FRETE_VINCULO`) e o principal existe
--      (`COMPL_FRETE_PRINCIPAL`), tambem sob `FOR UPDATE`
--   5. complemento nao avulso (`COMPL_FRETE_AVULSA`)
--   6. modalidade do complemento = CIF (`COMPL_FRETE_MODALIDADE`) — RETIRA e
--      FOB nao cobram frete
--   7. complemento em NOVO ou AGUARDANDO (`COMPL_FRETE_STATUS`): escrever
--      `cotacao_frete` dispara `atualizar_status_financeiro_proposta`, que
--      reescreve status nao protegido; depois de LIBERADO a correcao e pelos
--      fluxos existentes
--   8. principal ainda nao expedido, regra composta (`COMPL_FRETE_EXPEDIDO`):
--      status entre LIBERADO e EXPEDICAO e sem `expedicoes.data_despacho`
--   9. guarda otimista sobre o frete do principal (`COMPL_FRETE_CONCORRENCIA`):
--      `round(valor_frete,2)` tem de bater com o que foi cotado
--  10. peso do complemento no banco bate com o cotado, +/- 1 g
--      (`COMPL_FRETE_PESO`) — mesma tolerancia da guarda de frete desatualizado
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO escreve em `cotacao_frete` nem em `propostas` do PRINCIPAL.
--   NAO altera trigger, funcao existente, view nem RLS.
--   NAO mexe em Conta Corrente, cobranca, boleto, NF-e nem Expedicao.
--   NAO grava chat: isso e da rota, best-effort, fora da transacao.
--   NAO concede `propostas.complementar` a perfil nenhum (E10).
--   NAO desvincula complemento (E8).
--
-- VERIFICACAO (rodar depois de aplicar)
--
-- a) Funcao:
--    SELECT prosecdef, proconfig, pg_get_function_result(oid)
--      FROM pg_proc WHERE proname = 'complementar_aplicar_frete';
--    Esperado: true; {search_path=public, pg_temp}; bigint.
--
-- b) Quem executa:
--    SELECT r.rolname, has_function_privilege(r.oid,
--      'public.complementar_aplicar_frete(bigint,uuid,integer,text,integer,numeric,numeric,text,text,text,text,uuid,numeric,numeric,jsonb,text,text)',
--      'EXECUTE') FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
--    Esperado: anon false; authenticated true.
--
-- c) Depois de aplicar um frete complementar de verdade:
--    SELECT * FROM public.complementos_frete WHERE id_int_complemento = <Y>;   -- 1 linha
--    SELECT id, valor, peso FROM public.cotacao_frete WHERE id_int = <Y>;      -- valor = a cobrar, peso = peso de Y
--    SELECT id, valor, peso FROM public.cotacao_frete WHERE id_int = <X>;      -- MESMO id de antes
--    Repetir a mesma `chave` devolve o mesmo `id` e nao grava nada.
--
-- d) Triggers de `cotacao_frete` e `propostas` inalterados: comparar
--    md5(pg_get_triggerdef) e md5(pg_get_functiondef) com o retrato de antes.
--
-- ROLLBACK
--   DROP FUNCTION public.complementar_aplicar_frete(bigint,uuid,integer,text,integer,numeric,numeric,text,text,text,text,uuid,numeric,numeric,jsonb,text,text);
--   Nao desfaz frete ja aplicado: as linhas do ledger e a cotacao do
--   complemento continuam onde estao.

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
  if upper(coalesce(btrim(v_compl.status_interno), '')) not in ('NOVO', 'AGUARDANDO') then
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

comment on function public.complementar_aplicar_frete(bigint,uuid,integer,text,integer,numeric,numeric,text,text,text,text,uuid,numeric,numeric,jsonb,text,text) is
  'Pedido complementar, E6. Aplica UMA opcao do frete do peso somado: grava o ledger complementos_frete, a cotacao DO COMPLEMENTO e valor_frete/frete_escolhido DO COMPLEMENTO, numa transacao. Idempotente por chave. NAO toca cotacao_frete nem propostas do pedido principal.';

revoke execute on function public.complementar_aplicar_frete(bigint,uuid,integer,text,integer,numeric,numeric,text,text,text,text,uuid,numeric,numeric,jsonb,text,text) from public;
grant execute on function public.complementar_aplicar_frete(bigint,uuid,integer,text,integer,numeric,numeric,text,text,text,text,uuid,numeric,numeric,jsonb,text,text) to authenticated;
