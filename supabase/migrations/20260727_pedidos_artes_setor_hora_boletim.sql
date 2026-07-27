-- Boletim de Produção (OS) — campos próprios do boletim.
--
-- Contexto: o novo layout do Boletim de Produção precisa de um SETOR próprio do
-- boletim (hoje o PDF reaproveitava um setor fixo vindo do cadastro do produto) e
-- de uma HORA do prazo. Cada boletim pertence a um único setor; uma proposta pode
-- possuir vários boletins (um por setor), todos vinculados ao mesmo id_int.
--
-- Aditivo e reversível: apenas colunas novas, anuláveis, sem default e sem
-- alteração de RLS, triggers ou dados existentes.

alter table public.pedidos_artes
  add column if not exists setor text,
  add column if not exists hora time without time zone;

comment on column public.pedidos_artes.setor is
  'Setor de produção do boletim (campo próprio do boletim — não reutilizar o setor do cadastro do produto).';

comment on column public.pedidos_artes.hora is
  'Hora do prazo do boletim (HH:MM). Campo próprio do boletim — não reutilizar created_at.';
