-- notas_fiscais.ambiente: quatro notas de PRODUCAO deixam de dizer homologacao
--
-- O QUE MUDA
--   Quatro linhas de `public.notas_fiscais`, nomeadas uma a uma pela `ref`.
--   Nada mais. Nenhuma coluna nova, nenhum DEFAULT alterado, nenhum criterio
--   amplo por status ou por empresa, nenhuma nota de servico tocada.
--
--     ref              empresa  numero  autorizada em  proposta
--     ---------------  -------  ------  -------------  --------
--     NFE-20975-001    1        48000   25/08/2026     20975
--     NFE-21341-001    1        48001   27/08/2026     21341
--     NFE-20972-001    3        41000   01/09/2026     20972
--     NFE-20935-001    3        41001   01/09/2026     20935
--
-- POR QUE
--   As quatro sairam em PRODUCAO e estao registradas como homologacao. A
--   evidencia esta no proprio retorno da Focus, gravado em `payload_retorno`:
--
--     1. `requisicao_nota_fiscal.ambiente = "1"`  -> tpAmb 1 = producao
--     2. `protocolo_nota_fiscal.ambiente  = "1"`  -> o protocolo da SEFAZ tambem
--     3. `caminho_danfe` sob `/arquivos/`          -> em homologacao a Focus usa
--                                                     `/arquivos_development/`
--
--   As tres sao verificadas nas assercoes de entrada, nota por nota.
--
--   A causa ja foi corrigida nos passos 1 e 2:
--     passo 1 (20260902185233) pos `empresas.ambiente_nfe` da E3 em producao;
--     passo 2 (commit e67f879) fez a emissao sincronizar o ambiente com
--       `empresas` no momento da transmissao, dentro do compare-and-swap da
--       rota /api/fiscal/emitir-nfe.
--   Sem os dois, corrigir estas quatro seria enxugar gelo. Este e o passo 3.
--
-- EFEITO DE COMPORTAMENTO — AUTORIZADO, E E O PONTO
--   `isNotaImpeditiva` (src/features/cobrancas/cancelamento-elegibilidade.ts)
--   exige `status = AUTORIZADA` E `ambiente = PRODUCAO` para recusar o
--   cancelamento de uma cobranca com a recusa `NOTA_AUTORIZADA`. Como hoje
--   NENHUMA nota tem ambiente producao, essa regra nunca disparou — dava para
--   cancelar cobranca de proposta com NF-e real autorizada, sem aviso.
--
--   Depois desta migration a regra passa a valer para as quatro propostas
--   acima, em cinco rotas: cancelar-externo, cancelar-pago,
--   cancelar-boleto-faturado, pode-cancelar e orcamentos/cancelar-proposta.
--
--   Nenhuma das quatro perde um cancelamento que hoje seria aceito: as quatro
--   propostas ja sao recusadas por outra regra (`is_prd_aprovado = true` ->
--   PRODUCAO_ATIVA), e tres delas tambem por dinheiro recebido
--   (COBRANCA_RECEBIDA). A correcao acrescenta o motivo certo, nao um bloqueio
--   novo. Nenhuma outra proposta e afetada: depois daqui, exatamente quatro
--   notas ficam em producao, uma por proposta.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   - nao altera nota alguma alem das quatro nomeadas;
--   - nao usa criterio amplo: sao quatro UPDATEs por `ref`, cada um conferindo
--     que afetou exatamente uma linha;
--   - nao toca em `notas_servico`, em `empresas`, no DEFAULT da coluna, nem na
--     regra `isNotaImpeditiva` e nas cinco rotas.
--
-- ATOMICIDADE
--   Tudo num unico bloco DO: qualquer assercao que falhe reverte os quatro
--   UPDATEs juntos.

do $$
declare
  r                   record;
  v_afetadas          integer;
  v_producao          integer;
  v_homologacao       integer;
  v_servico_fora      integer;
  v_total             integer;
  refs                text[] := array[
                         'NFE-20975-001',
                         'NFE-21341-001',
                         'NFE-20972-001',
                         'NFE-20935-001'
                       ];
  v_ref               text;
begin
  -- =========================================================================
  -- ASSERCOES DE ENTRADA — nota por nota
  -- =========================================================================
  foreach v_ref in array refs loop
    select
      nf.ref,
      nf.ambiente,
      nf.status,
      nf.payload_retorno->'requisicao_nota_fiscal'->>'ambiente'  as tpamb_requisicao,
      nf.payload_retorno->'protocolo_nota_fiscal'->>'ambiente'   as tpamb_protocolo,
      nf.payload_retorno->>'caminho_danfe'                       as caminho_danfe
      into r
      from public.notas_fiscais nf
     where nf.ref = v_ref;

    if not found then
      raise exception 'ENTRADA: nota % nao existe. Nada foi alterado.', v_ref;
    end if;

    if r.ambiente is distinct from 'homologacao' then
      raise exception
        'ENTRADA: nota % esperava ambiente = homologacao, encontrou %. Nada foi alterado.',
        v_ref, coalesce(r.ambiente, '<null>');
    end if;

    if r.status is distinct from 'AUTORIZADA' then
      raise exception
        'ENTRADA: nota % esperava status = AUTORIZADA, encontrou %. Nada foi alterado.',
        v_ref, coalesce(r.status, '<null>');
    end if;

    -- Evidencia 1 e 2: tpAmb da requisicao e do protocolo da SEFAZ.
    if r.tpamb_requisicao is distinct from '1' then
      raise exception
        'ENTRADA: nota % nao tem evidencia de producao — requisicao_nota_fiscal.ambiente = %, esperava 1. Nada foi alterado.',
        v_ref, coalesce(r.tpamb_requisicao, '<ausente>');
    end if;

    if r.tpamb_protocolo is distinct from '1' then
      raise exception
        'ENTRADA: nota % nao tem evidencia de producao — protocolo_nota_fiscal.ambiente = %, esperava 1. Nada foi alterado.',
        v_ref, coalesce(r.tpamb_protocolo, '<ausente>');
    end if;

    -- Evidencia 3: em homologacao a Focus serve os arquivos sob
    -- /arquivos_development/, que NAO casa com o padrao abaixo.
    if r.caminho_danfe is null or r.caminho_danfe not like '/arquivos/%' then
      raise exception
        'ENTRADA: nota % nao tem evidencia de producao — caminho_danfe = %, esperava prefixo /arquivos/. Nada foi alterado.',
        v_ref, coalesce(r.caminho_danfe, '<ausente>');
    end if;
  end loop;

  -- =========================================================================
  -- A ALTERACAO — uma a uma, por ref, nunca por criterio amplo
  -- =========================================================================
  update public.notas_fiscais set ambiente = 'producao' where ref = 'NFE-20975-001';
  get diagnostics v_afetadas = row_count;
  if v_afetadas <> 1 then
    raise exception 'UPDATE de NFE-20975-001 afetou % linha(s), esperava 1. Revertido.', v_afetadas;
  end if;

  update public.notas_fiscais set ambiente = 'producao' where ref = 'NFE-21341-001';
  get diagnostics v_afetadas = row_count;
  if v_afetadas <> 1 then
    raise exception 'UPDATE de NFE-21341-001 afetou % linha(s), esperava 1. Revertido.', v_afetadas;
  end if;

  update public.notas_fiscais set ambiente = 'producao' where ref = 'NFE-20972-001';
  get diagnostics v_afetadas = row_count;
  if v_afetadas <> 1 then
    raise exception 'UPDATE de NFE-20972-001 afetou % linha(s), esperava 1. Revertido.', v_afetadas;
  end if;

  update public.notas_fiscais set ambiente = 'producao' where ref = 'NFE-20935-001';
  get diagnostics v_afetadas = row_count;
  if v_afetadas <> 1 then
    raise exception 'UPDATE de NFE-20935-001 afetou % linha(s), esperava 1. Revertido.', v_afetadas;
  end if;

  -- =========================================================================
  -- ASSERCOES DE SAIDA
  -- =========================================================================

  -- 1. Exatamente quatro notas em producao, e sao exatamente as nomeadas.
  select count(*) into v_producao
    from public.notas_fiscais where ambiente = 'producao';

  if v_producao <> 4 then
    raise exception
      'SAIDA: % nota(s) em producao, esperava exatamente 4. Revertido.', v_producao;
  end if;

  select count(*) into v_producao
    from public.notas_fiscais
   where ambiente = 'producao' and not (ref = any(refs));

  if v_producao <> 0 then
    raise exception
      'SAIDA: % nota(s) em producao fora da lista das quatro. Revertido.', v_producao;
  end if;

  -- 2. As demais 24 seguem em homologacao, e o total nao mudou.
  select count(*) into v_total from public.notas_fiscais;
  select count(*) into v_homologacao
    from public.notas_fiscais where ambiente = 'homologacao';

  if v_total <> 28 then
    raise exception
      'SAIDA: notas_fiscais tem % linhas, esperava 28. Revertido.', v_total;
  end if;

  if v_homologacao <> 24 then
    raise exception
      'SAIDA: % nota(s) em homologacao, esperava 24. Revertido.', v_homologacao;
  end if;

  -- 3. notas_servico intacta: cinco linhas, todas em homologacao.
  select count(*) into v_servico_fora
    from public.notas_servico where ambiente is distinct from 'homologacao';

  if v_servico_fora <> 0 then
    raise exception
      'SAIDA: % nota(s) de servico saiu(ram) de homologacao. Revertido.', v_servico_fora;
  end if;

  select count(*) into v_servico_fora from public.notas_servico;

  if v_servico_fora <> 5 then
    raise exception
      'SAIDA: notas_servico tem % linhas, esperava 5. Revertido.', v_servico_fora;
  end if;

  raise notice 'OK: 4 notas passaram para producao (20975, 21341, 20972, 20935). 24 seguem em homologacao. notas_servico intacta.';
end $$;

-- =============================================================================
-- ROLLBACK
--
--   do $$
--   declare v_afetadas integer;
--   begin
--     update public.notas_fiscais
--        set ambiente = 'homologacao'
--      where ref in ('NFE-20975-001','NFE-21341-001','NFE-20972-001','NFE-20935-001');
--
--     get diagnostics v_afetadas = row_count;
--     if v_afetadas <> 4 then
--       raise exception 'ROLLBACK afetou % linha(s), esperava 4.', v_afetadas;
--     end if;
--   end $$;
--
--   ATENCAO: reverter volta a dizer que quatro notas fiscais reais de producao
--   sao de homologacao, e desliga de novo a recusa NOTA_AUTORIZADA — voltando a
--   permitir cancelar cobranca de proposta com NF-e autorizada na SEFAZ.
-- =============================================================================
