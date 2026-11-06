-- Unicidade de parcela passa a ser POR COBRANCA, e nao por pedido
--
-- REGRA (dois indices parciais, so titulos ATIVOS)
--   1. titulo COM cobranca (`id_pagamento` preenchido): no maximo um por
--      (id_int, id_pagamento, parcela);
--   2. titulo SEM cobranca (`id_pagamento` nulo ou vazio — legado, o ultimo e
--      de 31/08/2026): a regra antiga, no maximo um por (id_int, parcela).
--   O indice novo nasce ANTES de o antigo sair, na mesma transacao.
--
-- PROBLEMA QUE MOTIVOU (06/11/2026, pedido 24253, E3, NF-e 41389)
--   O pedido tem duas cobrancas: 24253-B, boleto de entrada R$ 6.720,00 (pago,
--   parcela 1/1 em `boletos`), e 24253-C, faturado R$ 6.719,45, confirmado e
--   sem titulo. `boletos_unico_parcela_ativo (id_int, parcela)` faz a parcela 1
--   da entrada ocupar a parcela 1 do faturado: o Gerar titulos da 24253-C
--   estouraria no banco. A tela (Registro de recebiveis e PrepararBoletosModal)
--   passa a olhar a cobranca no mesmo commit (titulo-da-cobranca.ts). Na tela o
--   titulo sem cobranca e ainda mais conservador: ocupa a parcela de TODAS as
--   cobrancas do pedido.
--
-- O PREDICADO
--   O mesmo de 06/08: `upper(status) is distinct from 'CANCELADO'` (status
--   nulo conta como ativo). Vazio = `id_pagamento is null or btrim(...) = ''`
--   (conferido em 06/11/2026: zero vazios, zero com espaco nas pontas).
--
-- ANTES DE APLICAR — verificacao obrigatoria (esperado: ZERO linhas nas duas)
--     select id_int, id_pagamento, parcela, count(*) from public.boletos
--      where upper(status) is distinct from 'CANCELADO'
--        and id_pagamento is not null and btrim(id_pagamento) <> ''
--      group by 1, 2, 3 having count(*) > 1;
--     select id_int, parcela, count(*) from public.boletos
--      where upper(status) is distinct from 'CANCELADO'
--        and (id_pagamento is null or btrim(id_pagamento) = '')
--      group by 1, 2 having count(*) > 1;
--
-- O QUE MUDA ALEM DO 24253
--   Duas cobrancas DIFERENTES do mesmo pedido passam a poder ter, cada uma, a
--   sua parcela 1 ativa (ex.: entrada em boleto + faturado). A mesma cobranca
--   continua sem poder repetir parcela, e o legado sem cobranca continua com a
--   regra antiga. `idx_boletos_n_doc_boleto_ativo` (referencia unica entre
--   ativos) nao muda.
--
-- NAO FAZ
--   Nao altera nem apaga titulo, cobranca ou proposta.
--
-- REVERSAO (so enquanto nenhum pedido tiver usado a chave nova)
--   create unique index boletos_unico_parcela_ativo on public.boletos
--     using btree (id_int, parcela) where (upper(status) is distinct from 'CANCELADO');
--   drop index if exists public.boletos_unico_parcela_ativo_por_cobranca;
--   drop index if exists public.boletos_unico_parcela_ativo_sem_cobranca;

begin;

create unique index boletos_unico_parcela_ativo_por_cobranca
  on public.boletos using btree (id_int, id_pagamento, parcela)
  where (upper(status) is distinct from 'CANCELADO'
         and id_pagamento is not null and btrim(id_pagamento) <> '');

create unique index boletos_unico_parcela_ativo_sem_cobranca
  on public.boletos using btree (id_int, parcela)
  where (upper(status) is distinct from 'CANCELADO'
         and (id_pagamento is null or btrim(id_pagamento) = ''));

drop index if exists public.boletos_unico_parcela_ativo;

commit;
