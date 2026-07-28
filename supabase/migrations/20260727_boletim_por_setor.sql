-- Boletim de Producao por SETOR (multiplos boletins por proposta).
--
-- Modelo:
--   propostas_os        -> o PEDIDO da proposta (1 por id_int, inalterado)
--   pedidos_artes.id    -> o BOLETIM (identidade propria; e por ele que o PDF e gerado)
--   pedidos_artes.id_int-> vinculo com a proposta
--   pedidos_artes.setor -> atributo do boletim (pode ser renomeado sem quebrar links)
--   pedidos_modelos.setor -> a que boletim/setor o modelo pertence
--
-- Aditivo e reversivel: 2 colunas anulaveis sem default + 1 indice unico parcial.
-- Nao altera RLS, triggers, RPC nem dados existentes.
-- Compatibilidade: linhas legadas ficam com setor NULL e seguem validas — o indice
-- e parcial (WHERE setor IS NOT NULL), entao nao conflita com o historico.

alter table public.pedidos_modelos
  add column if not exists setor text;

alter table public.pedidos_artes
  add column if not exists prazo date;

create unique index if not exists pedidos_artes_id_int_setor_uidx
  on public.pedidos_artes (id_int, setor)
  where setor is not null;

comment on column public.pedidos_modelos.setor is
  'Setor de producao do modelo. Define em qual boletim (pedidos_artes) o modelo e impresso. NULL = legado, anterior ao boletim por setor.';

comment on column public.pedidos_artes.prazo is
  'Prazo de entrega do boletim (do setor), independente do prazo do pedido em propostas_os.data_termino.';
