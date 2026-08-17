-- expedicoes.etiqueta_impressa_em — registro da geracao da etiqueta 10x15
--
-- O QUE E
--   Timestamp gravado pela rota /api/expedicao/etiqueta quando o PDF 10x15 e
--   gerado com sucesso. Sem isso a impressao interna nao deixava rastro.
--
-- POR QUE
--   A visao "Por transportadora" da Expedicao pinta de azul os pedidos com
--   etiqueta ja gerada (prepostagem Correios OU rastreio OU 10x15) e exibe o
--   sub-estado visual "Aguardando transportadora" (pedido PRONTO + etiqueta,
--   aguardando coleta). O status oficial em propostas.status_interno NAO muda:
--   EXPEDICAO -> A RETIRAR | EM TRANSITO -> ENTREGUE segue identico.
--
-- ROLLBACK
--   alter table public.expedicoes drop column if exists etiqueta_impressa_em;

alter table public.expedicoes
  add column if not exists etiqueta_impressa_em timestamptz;

comment on column public.expedicoes.etiqueta_impressa_em is
  'Ultima geracao da etiqueta interna 10x15 (rota /api/expedicao/etiqueta). Sub-estado visual "Aguardando transportadora" = pedido PRONTO com etiqueta gerada; status oficial nao muda.';
