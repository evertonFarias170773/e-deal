-- empresas.ambiente_nfe da E3 BRINDES: homologacao -> producao
--
-- O QUE MUDA
--   Uma celula: `public.empresas.ambiente_nfe` da empresa id = 3 (E3 BRINDES
--   LTDA, CNPJ 28699310000165). Nada mais. Nenhuma coluna nova, nenhum trigger,
--   nenhuma funcao, nenhuma RLS, nenhum backfill em nota fiscal alguma.
--
-- POR QUE
--   A coluna dizia `homologacao` e a E3 emite em PRODUCAO desde 25/08/2026.
--   Quem decide o ambiente de verdade nao e esta coluna: e o no `Switch` do
--   workflow n8n `Focus NFe Homologacao` (bLRbWquDs2WV63Du), que roteia por
--   `payload.cnpj_emitente` e manda tres CNPJs para tres destinos fixos:
--
--     14152597000102  IDEAL GRAFICA  -> api.focusnfe.com.br          PRODUCAO
--     33413131000150  IDEAL BIRO     -> homologacao.focusnfe.com.br  homologacao
--     28699310000165  E3 BRINDES     -> api.focusnfe.com.br          PRODUCAO
--
--   A Focus ignora o campo `ambiente` que mandamos no payload e decide pelo
--   endpoint/token: em NFE-20935-001 enviamos "homologacao" e ela gravou
--   tpAmb = 1 (producao), com protocolo valido da SEFAZ-RS.
--
--   Enquanto a coluna mente, quatro notas fiscais REAIS de producao estao
--   registradas como homologacao:
--
--     NFE-20975-001  empresa 1  25/08/2026
--     NFE-21341-001  empresa 1  27/08/2026
--     NFE-20972-001  empresa 3  01/09/2026
--     NFE-20935-001  empresa 3  01/09/2026
--
--   Elas NAO sao corrigidas aqui — isso e o passo 3 de 3, separado e com efeito
--   de comportamento (ver adiante).
--
-- QUEM LE ESTA COLUNA HOJE
--   Ninguem roteia por ela. Dois caminhos a leem e GRAVAM o valor em
--   `notas_fiscais.ambiente`:
--
--     1. `handleReenviarNfe` (src/features/fiscal/NotasFiscaisPage.tsx)
--        Ao reenviar, le `empresas.ambiente_nfe` e escreve na nota + no
--        `payload_envio`. Hoje, reenviar uma nota da E3 grava `homologacao`
--        numa nota que vai sair em producao.
--
--     2. `fn_trocar_empresa_nfe`
--        `update public.notas_fiscais set ... ambiente = v_emp.ambiente_nfe`.
--
--   Por isso esta correcao vem ANTES das outras duas: sem ela, os dois caminhos
--   reintroduzem o valor errado a cada reenvio ou troca de empresa.
--
-- O QUE ESTA MIGRATION NAO FAZ, DE PROPOSITO
--   - nao toca em `notas_fiscais.ambiente` de nota alguma (passo 3 de 3);
--   - nao toca em `ambiente_nfse` de empresa alguma — em NFS-e a coluna e o
--     Switch concordam: os tres destinos sao homologacao;
--   - nao toca no Switch do n8n;
--   - nao toca na regra `isNotaImpeditiva`, que exige ambiente = PRODUCAO para
--     recusar cancelamento de cobranca. Ela so passa a disparar quando as
--     quatro notas forem corrigidas, no passo 3.
--
-- EFEITO COLATERAL CONHECIDO, E INOFENSIVO
--   `empresas` tem o trigger BEFORE UPDATE `trg_empresas_dados_agrupados`, que
--   recalcula `dados_agrupados` a partir de empresa/cnpj/banco/agencia/conta.
--   Nenhum desses campos muda aqui, entao o trigger reescreve o mesmo texto.
--   Ha assercao de saida conferindo isso.
--
-- ATOMICIDADE
--   Tudo num unico bloco DO: se qualquer assercao falhar, o bloco inteiro e
--   revertido e o UPDATE nao persiste.

do $$
declare
  v_ambiente_antes    text;
  v_dados_antes       text;
  v_ambiente_depois   text;
  v_dados_depois      text;
  v_afetadas          integer;
  v_fora_do_esperado  integer;
begin
  -- =========================================================================
  -- ASSERCOES DE ENTRADA
  -- =========================================================================

  select ambiente_nfe, dados_agrupados
    into v_ambiente_antes, v_dados_antes
    from public.empresas
   where id = 3;

  if not found then
    raise exception
      'ENTRADA: empresa id = 3 nao existe. Nada foi alterado.';
  end if;

  if v_ambiente_antes is distinct from 'homologacao' then
    raise exception
      'ENTRADA: empresa 3 esperava ambiente_nfe = homologacao, encontrou %. Nada foi alterado.',
      coalesce(v_ambiente_antes, '<null>');
  end if;

  -- =========================================================================
  -- A ALTERACAO
  -- =========================================================================

  update public.empresas set ambiente_nfe = 'producao' where id = 3;

  get diagnostics v_afetadas = row_count;

  if v_afetadas <> 1 then
    raise exception
      'UPDATE afetou % linha(s), esperava exatamente 1. Revertido.', v_afetadas;
  end if;

  -- =========================================================================
  -- ASSERCOES DE SAIDA
  -- =========================================================================

  -- 1. A empresa 3 ficou em producao, e o dados_agrupados nao mudou.
  select ambiente_nfe, dados_agrupados
    into v_ambiente_depois, v_dados_depois
    from public.empresas
   where id = 3;

  if v_ambiente_depois is distinct from 'producao' then
    raise exception
      'SAIDA: empresa 3 ficou com ambiente_nfe = %, esperava producao. Revertido.',
      coalesce(v_ambiente_depois, '<null>');
  end if;

  if v_dados_depois is distinct from v_dados_antes then
    raise exception
      'SAIDA: dados_agrupados da empresa 3 mudou. Antes: [%] Depois: [%]. Revertido.',
      v_dados_antes, v_dados_depois;
  end if;

  -- 2. As demais empresas seguem com o ambiente_nfe que tinham.
  select count(*) into v_fora_do_esperado
    from public.empresas
   where (id = 1 and ambiente_nfe is distinct from 'producao')
      or (id = 2 and ambiente_nfe is distinct from 'homologacao')
      or (id = 4 and ambiente_nfe is distinct from 'homologacao');

  if v_fora_do_esperado <> 0 then
    raise exception
      'SAIDA: % empresa(s) fora do ambiente_nfe esperado (1=producao, 2=homologacao, 4=homologacao). Revertido.',
      v_fora_do_esperado;
  end if;

  -- 3. Os quatro ambiente_nfse continuam intactos, todos em homologacao.
  select count(*) into v_fora_do_esperado
    from public.empresas
   where ambiente_nfse is distinct from 'homologacao';

  if v_fora_do_esperado <> 0 then
    raise exception
      'SAIDA: % empresa(s) com ambiente_nfse fora de homologacao. Revertido.',
      v_fora_do_esperado;
  end if;

  -- 4. Nenhuma nota mudou de ambiente. Se existisse trigger propagando
  --    empresas -> notas, este contador acusaria.
  select count(*) into v_fora_do_esperado
    from public.notas_fiscais
   where ambiente is distinct from 'homologacao';

  if v_fora_do_esperado <> 0 then
    raise exception
      'SAIDA: % nota(s) fiscal(is) saiu(ram) de homologacao por efeito desta migration. Revertido.',
      v_fora_do_esperado;
  end if;

  select count(*) into v_fora_do_esperado
    from public.notas_servico
   where ambiente is distinct from 'homologacao';

  if v_fora_do_esperado <> 0 then
    raise exception
      'SAIDA: % nota(s) de servico saiu(ram) de homologacao por efeito desta migration. Revertido.',
      v_fora_do_esperado;
  end if;

  raise notice 'OK: empresas.ambiente_nfe da E3 (id 3) passou de homologacao para producao. Nenhuma nota alterada.';
end $$;

-- =============================================================================
-- ROLLBACK
--
--   Desfaz apenas esta migration. Nao restaura nada em notas_fiscais, porque
--   esta migration nao escreveu la.
--
--   do $$
--   begin
--     update public.empresas set ambiente_nfe = 'homologacao' where id = 3;
--
--     if (select ambiente_nfe from public.empresas where id = 3) <> 'homologacao' then
--       raise exception 'ROLLBACK falhou: empresa 3 nao voltou para homologacao.';
--     end if;
--   end $$;
--
--   ATENCAO: reverter devolve a divergencia. A E3 continuara emitindo em
--   producao pelo Switch do n8n enquanto a coluna disser homologacao, e
--   `handleReenviarNfe` / `fn_trocar_empresa_nfe` voltarao a gravar o valor
--   errado nas notas dela.
-- =============================================================================
