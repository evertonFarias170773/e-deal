-- ============================================================================
-- expedicoes — colunas da AWB da Azul Logistica (emissao pela Expedicao)
-- 09/10/2026 — autorizada nominalmente pelo dono (migration expedicoes_azul_awb).
--
-- O QUE É
--   Quatro colunas aditivas, todas nulaveis e sem default:
--
--     azul_awb          text         numero da AWB devolvido pela Azul (Value)
--     azul_emitida_em   timestamptz  quando a AWB foi gravada
--     azul_emitida_por  text         nome de quem emitiu (mesmo formato de despachado_por)
--     azul_status       text         EMITINDO | EMITIDA | INCERTA (nulo = nada em andamento)
--
-- POR QUE UMA COLUNA DE STATUS
--   A API da Azul nao tem chave de idempotencia e cada emissao cria contrato e
--   cobranca reais. A rota RESERVA a emissao com um UPDATE condicional
--   (azul_awb nula e azul_status nulo -> EMITINDO) antes de chamar a Azul;
--   duplo clique ou segunda aba nao passam. Erro da Azul libera a reserva
--   (volta a nulo); timeout sem resposta vira INCERTA e NAO e liberado sozinho.
--
-- NAO TOCA triggers, views nem funcoes: os tres triggers de expedicoes so reagem
-- a data_despacho, e nenhuma view le a tabela. codigo_rastreamento NAO e usado.
--
-- REVERSAO: alter table public.expedicoes drop column azul_awb, ... (so se
-- nenhuma AWB tiver sido gravada — a AWB e dado de uma cobranca real da Azul).
-- ============================================================================

alter table public.expedicoes
  add column if not exists azul_awb text,
  add column if not exists azul_emitida_em timestamptz,
  add column if not exists azul_emitida_por text,
  add column if not exists azul_status text;

alter table public.expedicoes
  drop constraint if exists expedicoes_azul_status_check;
alter table public.expedicoes
  add constraint expedicoes_azul_status_check
  check (azul_status is null or azul_status in ('EMITINDO', 'EMITIDA', 'INCERTA'));

-- AWB gravada se e somente se o status e EMITIDA.
alter table public.expedicoes
  drop constraint if exists expedicoes_azul_awb_coerente_check;
alter table public.expedicoes
  add constraint expedicoes_azul_awb_coerente_check
  check ((azul_status is not distinct from 'EMITIDA') = (azul_awb is not null));

comment on column public.expedicoes.azul_awb is 'AWB da Azul Logistica (EmissaoAWB/Enviar, Value). Uma por expedicao.';
comment on column public.expedicoes.azul_status is 'EMITINDO = reservada, chamada em curso; EMITIDA = AWB gravada; INCERTA = sem resposta da Azul, conferir la antes de liberar. Nulo = sem emissao.';
