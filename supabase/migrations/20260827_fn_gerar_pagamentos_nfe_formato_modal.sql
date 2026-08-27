-- `fn_gerar_pagamentos_nfe` passa a aceitar o formato do modal Preparar Cobranca
--
-- POR QUE
--   A aba Pagamentos da NF e o modal Preparar Cobranca geram parcelas com
--   formatos diferentes. Faltam na aba o modo de parcela unica com vencimento
--   escolhido e o arredondamento de valores; e a sobra de centavos e calculada
--   por `round`, enquanto o modal usa `floor` — com as mesmas entradas os dois
--   podem produzir parcelas diferentes.
--
--   Esta migration alinha os dois SEM tirar o calculo do servidor: a RPC
--   continua sendo quem calcula, com SECURITY DEFINER e DELETE + INSERT atomico
--   por `ref`.
--
-- POR QUE PRECISA DE DROP (e nao CREATE OR REPLACE)
--   `CREATE OR REPLACE FUNCTION` so substitui quando a lista de tipos de
--   argumento e identica. Acrescentar parametros — mesmo todos com DEFAULT —
--   cria uma SEGUNDA funcao, sobrecarregada. Com as duas no catalogo, uma
--   chamada com os 6 argumentos antigos casa com as duas candidatas e o
--   Postgres recusa com "function is not unique"; pelo PostgREST o efeito e
--   equivalente, porque a resolucao por nome passa a ter dois alvos.
--
--   Por isso: DROP seguido de CREATE, dentro da MESMA transacao. Nao ha janela
--   em que a funcao deixe de existir para quem chama.
--
-- COMPATIBILIDADE DOS CHAMADORES
--   A assinatura nova mantem os 6 parametros antigos, na mesma ordem e com os
--   mesmos tipos. Os 3 novos tem DEFAULT que reproduz o comportamento atual:
--
--     p_vencimento_unico date    default null   -> null = nao e parcela unica
--     p_arredondar       boolean default false  -> false = sem arredondamento
--     p_data_base        date    default null   -> null = notas_fiscais.created_at
--
--   Chamador existente (unico: `gerarPagamentosNfe`, em
--   src/features/nfe/services/nfe.service.ts) segue funcionando sem alteracao.
--   Verificado em 27/08/2026: nenhuma outra funcao, trigger ou view do banco
--   referencia `fn_gerar_pagamentos_nfe`.
--
-- ACL — ATENCAO
--   A funcao atual tem GRANT EXPLICITO alem do PUBLIC:
--
--     {=X/postgres, postgres=X/postgres, anon=X/postgres,
--      authenticated=X/postgres, service_role=X/postgres}
--
--   `anon` tem grant proprio: um `REVOKE ... FROM PUBLIC` NAO o alcancaria.
--   O bloco de GRANT no rodape reproduz o ACL exatamente como esta hoje. Se a
--   intencao algum dia for fechar para `anon`, e preciso REVOKE nominal — nao
--   e o que esta migration faz: ela preserva o estado atual, nem mais nem menos.
--
-- O QUE MUDA NO CALCULO
--   1. Parcela unica (`p_vencimento_unico` preenchido): gera UMA linha PARCELA
--      com o valor total da nota no vencimento informado. Ignora qtd, dias e
--      intervalo, igual ao modal. Incompativel com entrada > 0 — recusa.
--   2. Sobra de centavos: `trunc(saldo/qtd, 2)` no lugar de `round(saldo/qtd, 2)`,
--      com a diferenca na ULTIMA parcela. E o `Math.floor((total/qtd)*100)/100`
--      do modal. O total continua preservado nos dois casos.
--   3. Arredondamento (`p_arredondar = true`): base `round(saldo/qtd, 0)` — valor
--      inteiro em reais — e diferenca na ultima. Espelha o
--      `Math.round(total/totalParcelas)` do modal, que la e restrito a
--      admin/superadmin pela UI. So faz efeito com 2 ou mais parcelas.
--   4. `p_data_base` permite fixar a data base da primeira parcela. Com null,
--      continua `notas_fiscais.created_at::date`, exatamente como hoje.
--
-- O QUE NAO MUDA
--   Recusa quando `notas_fiscais.status` esta em AUTORIZADA ou PROCESSANDO.
--   SECURITY DEFINER, `search_path = public`, retorno jsonb, DELETE + INSERT por
--   `ref`, numeracao de duplicata (`lpad(n, 3, '0')`), `tipo_registro`
--   ENTRADA/PARCELA e todas as validacoes de entrada.
--
-- NAO FAZ
--   Nao altera linha de notas_fiscais_pagamentos ja gravada. Nao toca boletos,
--   pagamentos_v2, notas_fiscais, RLS ou permissoes de tabela. Nao cria coluna,
--   tabela nem indice.
--
-- ROLLBACK: ver rodape.

begin;

drop function if exists public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text);

create function public.fn_gerar_pagamentos_nfe(
  p_ref text,
  p_valor_entrada numeric default null,
  p_qtd_parcelas integer default 1,
  p_dias_pra_inicio integer default 0,
  p_intervalo integer default 30,
  p_forma_pagamento text default '99',
  p_vencimento_unico date default null,
  p_arredondar boolean default false,
  p_data_base date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nf record;

  v_valor_total numeric(12,2) := 0;
  v_valor_entrada numeric(12,2) := 0;
  v_saldo_parcelar numeric(12,2) := 0;

  v_total_registros integer := 0;
  v_numero_parcela integer := 0;

  v_valor_parcela numeric(12,2) := 0;
  v_valor_lancamento numeric(12,2) := 0;
  v_total_lancado numeric(12,2) := 0;

  v_data_inicio date;
  v_data_vencimento date;
  v_base_date date;

  v_forma_pagamento text := '99';
  v_descricao_forma_pagamento text := 'Outros';

  v_parcela_unica boolean := false;
  v_arredondar boolean := coalesce(p_arredondar, false);

  i integer;
begin
  if p_ref is null or trim(p_ref) = '' then
    return jsonb_build_object(
      'ok', false,
      'erro', 'REF_OBRIGATORIA',
      'mensagem', 'A ref da NF-e é obrigatória.'
    );
  end if;

  v_parcela_unica := p_vencimento_unico is not null;

  if not v_parcela_unica and coalesce(p_qtd_parcelas, 0) <= 0 then
    return jsonb_build_object(
      'ok', false,
      'erro', 'QTD_PARCELAS_INVALIDA',
      'mensagem', 'A quantidade de parcelas deve ser maior que zero.',
      'ref', p_ref
    );
  end if;

  if coalesce(p_intervalo, 0) < 0 then
    return jsonb_build_object(
      'ok', false,
      'erro', 'INTERVALO_INVALIDO',
      'mensagem', 'O intervalo não pode ser negativo.',
      'ref', p_ref
    );
  end if;

  v_forma_pagamento := coalesce(nullif(trim(p_forma_pagamento), ''), '99');

  v_descricao_forma_pagamento :=
    case v_forma_pagamento
      when '01' then 'Dinheiro'
      when '03' then 'Cartão de crédito'
      when '04' then 'Cartão de débito'
      when '15' then 'Boleto bancário'
      when '16' then 'Depósito bancário'
      when '17' then 'PIX'
      when '90' then 'Sem pagamento'
      when '99' then 'Outros'
      else 'Outros'
    end;

  select id, id_int, ref, status, valor_total_nf, created_at
    into v_nf
    from public.notas_fiscais
   where ref = p_ref
   limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'erro', 'NFE_NAO_ENCONTRADA',
      'mensagem', 'Nenhuma NF-e localizada para esta ref.',
      'ref', p_ref
    );
  end if;

  -- Preservado: nota transmitida nao tem parcela regerada. A duplicata ja foi
  -- para a SEFAZ.
  if coalesce(v_nf.status, '') in ('AUTORIZADA', 'PROCESSANDO') then
    return jsonb_build_object(
      'ok', false,
      'erro', 'NFE_NAO_EDITAVEL',
      'mensagem', 'Não é permitido regerar pagamentos de uma NF-e já autorizada ou em processamento.',
      'ref', p_ref,
      'status', v_nf.status
    );
  end if;

  v_valor_total := round(coalesce(v_nf.valor_total_nf, 0), 2);

  if v_valor_total <= 0 then
    return jsonb_build_object(
      'ok', false,
      'erro', 'VALOR_TOTAL_INVALIDO',
      'mensagem', 'A NF-e não possui valor total válido para gerar pagamentos.',
      'ref', p_ref,
      'valor_total_nf', v_valor_total
    );
  end if;

  v_valor_entrada := round(coalesce(p_valor_entrada, 0), 2);

  if v_valor_entrada < 0 then
    return jsonb_build_object(
      'ok', false,
      'erro', 'ENTRADA_INVALIDA',
      'mensagem', 'O valor de entrada não pode ser negativo.',
      'ref', p_ref
    );
  end if;

  if v_valor_entrada >= v_valor_total then
    return jsonb_build_object(
      'ok', false,
      'erro', 'ENTRADA_MAIOR_OU_IGUAL_TOTAL',
      'mensagem', 'A entrada não pode ser maior ou igual ao valor total da NF-e.',
      'ref', p_ref,
      'valor_total_nf', v_valor_total,
      'valor_entrada', v_valor_entrada
    );
  end if;

  -- Parcela unica e entrada sao mutuamente exclusivas: no modal, marcar parcela
  -- unica desliga o gerador inteiro. Aceitar os dois aqui geraria duas linhas
  -- num modo que existe justamente para gerar uma.
  if v_parcela_unica and v_valor_entrada > 0 then
    return jsonb_build_object(
      'ok', false,
      'erro', 'PARCELA_UNICA_COM_ENTRADA',
      'mensagem', 'Parcela única com vencimento específico não aceita valor de entrada.',
      'ref', p_ref
    );
  end if;

  -- Remove pagamentos anteriores da mesma NF-e antes de gerar novamente.
  -- Evita duplicidade quando o usuário muda parcelas, entrada, vencimento ou
  -- forma de pagamento.
  delete from public.notas_fiscais_pagamentos where ref = p_ref;

  v_base_date := coalesce(p_data_base, v_nf.created_at::date, current_date);
  v_data_inicio := v_base_date + coalesce(p_dias_pra_inicio, 0);

  if v_parcela_unica then
    -- UMA linha, valor total, na data escolhida.
    insert into public.notas_fiscais_pagamentos (
      id_int, ref, id_nota_fiscal, numero_parcela, total_parcelas,
      numero_duplicata, data_vencimento, valor, forma_pagamento,
      descricao_forma_pagamento, origem, observacao, ativo,
      dias_pra_inicio, intervalo_dias, tipo_registro
    )
    values (
      v_nf.id_int, v_nf.ref, v_nf.id, 1, 1,
      lpad('1', 3, '0'), p_vencimento_unico, v_valor_total, v_forma_pagamento,
      v_descricao_forma_pagamento, 'AUTO',
      'Parcela única com vencimento específico, gerada pela RPC fn_gerar_pagamentos_nfe.',
      true, 0, 0, 'PARCELA'
    );

    v_total_registros := 1;
    v_total_lancado := v_valor_total;

  elsif v_valor_entrada > 0 then
    v_total_registros := p_qtd_parcelas + 1;
    v_saldo_parcelar := v_valor_total - v_valor_entrada;

    v_numero_parcela := 1;

    insert into public.notas_fiscais_pagamentos (
      id_int, ref, id_nota_fiscal, numero_parcela, total_parcelas,
      numero_duplicata, data_vencimento, valor, forma_pagamento,
      descricao_forma_pagamento, origem, observacao, ativo,
      dias_pra_inicio, intervalo_dias, tipo_registro
    )
    values (
      v_nf.id_int, v_nf.ref, v_nf.id, v_numero_parcela, v_total_registros,
      lpad(v_numero_parcela::text, 3, '0'), v_base_date, v_valor_entrada,
      v_forma_pagamento, v_descricao_forma_pagamento, 'AUTO',
      'Entrada gerada automaticamente pela RPC fn_gerar_pagamentos_nfe.',
      true, 0, p_intervalo, 'ENTRADA'
    );

    v_total_lancado := v_valor_entrada;

    -- Alinhado ao modal: trunc no lugar de round, sobra na ultima parcela.
    if v_arredondar and p_qtd_parcelas > 1 then
      v_valor_parcela := round(v_saldo_parcelar / p_qtd_parcelas, 0);
    else
      v_valor_parcela := trunc(v_saldo_parcelar / p_qtd_parcelas, 2);
    end if;

    for i in 1..p_qtd_parcelas loop
      v_numero_parcela := i + 1;
      v_data_vencimento := v_data_inicio + (p_intervalo * (i - 1));

      if i < p_qtd_parcelas then
        v_valor_lancamento := v_valor_parcela;
      else
        v_valor_lancamento := round(v_valor_total - v_total_lancado, 2);
      end if;

      insert into public.notas_fiscais_pagamentos (
        id_int, ref, id_nota_fiscal, numero_parcela, total_parcelas,
        numero_duplicata, data_vencimento, valor, forma_pagamento,
        descricao_forma_pagamento, origem, observacao, ativo,
        dias_pra_inicio, intervalo_dias, tipo_registro
      )
      values (
        v_nf.id_int, v_nf.ref, v_nf.id, v_numero_parcela, v_total_registros,
        lpad(v_numero_parcela::text, 3, '0'), v_data_vencimento, v_valor_lancamento,
        v_forma_pagamento, v_descricao_forma_pagamento, 'AUTO',
        'Parcela gerada automaticamente pela RPC fn_gerar_pagamentos_nfe.',
        true, p_dias_pra_inicio, p_intervalo, 'PARCELA'
      );

      v_total_lancado := v_total_lancado + v_valor_lancamento;
    end loop;

  else
    v_total_registros := p_qtd_parcelas;
    v_saldo_parcelar := v_valor_total;
    v_total_lancado := 0;

    if v_arredondar and p_qtd_parcelas > 1 then
      v_valor_parcela := round(v_saldo_parcelar / p_qtd_parcelas, 0);
    else
      v_valor_parcela := trunc(v_saldo_parcelar / p_qtd_parcelas, 2);
    end if;

    for i in 1..p_qtd_parcelas loop
      v_numero_parcela := i;
      v_data_vencimento := v_data_inicio + (p_intervalo * (i - 1));

      if i < p_qtd_parcelas then
        v_valor_lancamento := v_valor_parcela;
      else
        v_valor_lancamento := round(v_valor_total - v_total_lancado, 2);
      end if;

      insert into public.notas_fiscais_pagamentos (
        id_int, ref, id_nota_fiscal, numero_parcela, total_parcelas,
        numero_duplicata, data_vencimento, valor, forma_pagamento,
        descricao_forma_pagamento, origem, observacao, ativo,
        dias_pra_inicio, intervalo_dias, tipo_registro
      )
      values (
        v_nf.id_int, v_nf.ref, v_nf.id, v_numero_parcela, v_total_registros,
        lpad(v_numero_parcela::text, 3, '0'), v_data_vencimento, v_valor_lancamento,
        v_forma_pagamento, v_descricao_forma_pagamento, 'AUTO',
        'Parcela gerada automaticamente pela RPC fn_gerar_pagamentos_nfe.',
        true, p_dias_pra_inicio, p_intervalo, 'PARCELA'
      );

      v_total_lancado := v_total_lancado + v_valor_lancamento;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'mensagem', 'Pagamentos da NF-e gerados com sucesso.',
    'ref', p_ref,
    'id_nota_fiscal', v_nf.id,
    'id_int', v_nf.id_int,
    'valor_total_nf', v_valor_total,
    'valor_entrada', v_valor_entrada,
    'qtd_parcelas_informada', p_qtd_parcelas,
    'total_registros_criados', v_total_registros,
    'dias_pra_inicio', p_dias_pra_inicio,
    'intervalo_dias', p_intervalo,
    'forma_pagamento', v_forma_pagamento,
    'descricao_forma_pagamento', v_descricao_forma_pagamento,
    'parcela_unica', v_parcela_unica,
    'vencimento_unico', p_vencimento_unico,
    'arredondado', (v_arredondar and not v_parcela_unica and p_qtd_parcelas > 1),
    'data_base', v_base_date,
    'total_lancado', v_total_lancado
  );
end;
$function$;

-- ACL reproduzido exatamente como estava antes do DROP. `anon` tem grant
-- nominal: sem esta linha ele PERDERIA o acesso que tem hoje.
grant execute on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text, date, boolean, date) to public;
grant execute on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text, date, boolean, date) to anon;
grant execute on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text, date, boolean, date) to authenticated;
grant execute on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text, date, boolean, date) to service_role;

comment on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text, date, boolean, date) is
  'Gera as parcelas fiscais (notas_fiscais_pagamentos) de uma NF-e por ref. Formato alinhado ao modal Preparar Cobranca: parcela unica com vencimento especifico, arredondamento opcional e sobra de centavos por trunc na ultima parcela. Recusa nota AUTORIZADA ou PROCESSANDO.';

commit;

-- ============================================================================
-- ROLLBACK (executar em transacao)
--
-- Restaura a assinatura de 6 argumentos e o corpo anterior. Depois de aplicar o
-- rollback, a aba Pagamentos precisa voltar ao codigo anterior ao commit desta
-- etapa: com a funcao antiga no lugar, chamadas com os parametros novos falham.
--
-- begin;
--
-- drop function if exists public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text, date, boolean, date);
--
-- create function public.fn_gerar_pagamentos_nfe(
--   p_ref text,
--   p_valor_entrada numeric default null,
--   p_qtd_parcelas integer default 1,
--   p_dias_pra_inicio integer default 0,
--   p_intervalo integer default 30,
--   p_forma_pagamento text default '99'
-- ) returns jsonb language plpgsql security definer set search_path to 'public'
-- as $$ ... corpo anterior, recuperavel por
--      `select pg_get_functiondef(oid)` no commit 7844d4a ... $$;
--
-- grant execute on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text) to public;
-- grant execute on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text) to anon;
-- grant execute on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text) to authenticated;
-- grant execute on function public.fn_gerar_pagamentos_nfe(text, numeric, integer, integer, integer, text) to service_role;
--
-- commit;
-- ============================================================================
