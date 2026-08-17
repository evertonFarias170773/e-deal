-- expedicoes: ultimo evento de rastreio vindo do WEBHOOK oficial dos Correios
--
-- O QUE E
--   O receiver /api/correios/webhook grava aqui o ultimo evento recebido de
--   cada objeto (ex.: "PO-1: Objeto postado"), com o instante do evento.
--   Alem disso o receiver transiciona status: PO-*/CO-* (postagem/coleta) move
--   EXPEDICAO -> EM TRANSITO; eventos de entrega ao destinatario movem para
--   ENTREGUE — sempre com trilha em os_status_log (origem CORREIOS_WEBHOOK).
--
-- POR QUE
--   Antes o status so mudava na mao (Despachar / Marcar entregue) ou pela
--   consulta manual de rastro. Com o webhook o banco acompanha o objeto
--   sozinho, no momento em que os Correios registram o evento.
--
-- ROLLBACK
--   alter table public.expedicoes drop column if exists correios_ultimo_evento;
--   alter table public.expedicoes drop column if exists correios_ultimo_evento_em;

alter table public.expedicoes
  add column if not exists correios_ultimo_evento text,
  add column if not exists correios_ultimo_evento_em timestamptz;

comment on column public.expedicoes.correios_ultimo_evento is
  'Ultimo evento de rastreio recebido via webhook dos Correios (tipo + descricao). Escrito pelo receiver /api/correios/webhook (service-role).';
comment on column public.expedicoes.correios_ultimo_evento_em is
  'Instante do ultimo evento de rastreio recebido via webhook dos Correios.';
