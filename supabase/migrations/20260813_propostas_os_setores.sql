-- propostas_os_setores — o boletim de cada setor sai da tabela de ARTES
--
-- O QUE E
--   Uma linha por setor de producao do pedido (PVC, LASER, FLEXO, TEXTIL):
--   prazo, hora, fase de producao e a conferencia daquele setor.
--
-- POR QUE
--   O boletim de setor estava sendo gravado em public.pedidos_artes, que existe
--   para ARTE. Isso nao era so questao de nome — tinha efeito real:
--
--   1. public.check_and_promote_proposta le o status da linha MAIS RECENTE de
--      pedidos_artes (order by created_at desc limit 1). Abrir o boletim de um
--      setor novo criava uma linha nova e passava a ditar a evidencia de arte da
--      proposta inteira.
--   2. liberarPropostaParaProducao() exige que TODAS as linhas de pedidos_artes
--      estejam APROVADO. Duas linhas que eram boletim, nao arte, estavam em
--      'EM ARTE' (id_int 19514 e 20464) — a 20464 ficaria impedida de ser
--      liberada de novo por causa do proprio boletim.
--
--   propostas_os continua com UMA linha por pedido (e o cabecalho da OS: cliente,
--   endereco, rastreio, valores). Multiplicar as linhas dela por setor duplicaria
--   ~12 colunas que sao do pedido e quebraria dois `.maybeSingle()` por id_int
--   (pedidos-detalhe.service.ts e boletim-propostas.service.ts).
--
-- ONDE CADA COISA PASSA A MORAR
--   propostas              -> o pedido (dados globais)
--   propostas_os           -> cabecalho da OS, 1 por pedido
--   propostas_os_setores   -> 1 por setor: prazo, hora, fase, conferencia
--   pedidos_artes          -> so arte/briefing (arquivos, evento, designer)
--   pedidos_modelos        -> lotes, ja com a coluna setor
--
-- CONFERENCIA
--   peso real, volumes, tipo de volume e responsavel viviam como texto dentro de
--   propostas_os.obs, em blocos [Conferencia:SETOR]. Viram colunas aqui. Nenhuma
--   linha de propostas_os tinha esses blocos gravados (0 de 12), entao nao ha
--   dado a converter — so o codigo muda de destino.
--
-- MIGRACAO DE DADOS (10 linhas de pedidos_artes com setor)
--   a) todas viram linha em propostas_os_setores;
--   b) as 7 que eram SO boletim (sem arquivo, sem evento, sem designer, sem
--      observacoes) sao apagadas de pedidos_artes;
--   c) as 3 que tambem sao briefing de arte (18360, 19514, 20508/LASER) ficam,
--      apenas com setor/prazo/hora limpos.
--
-- ROLLBACK
--   -- 1. volta as 3 linhas de briefing:
--   update public.pedidos_artes set setor='LASER', prazo='2026-07-30', hora='12:00:00' where id='736397e5-5141-4959-9e5b-44323bafe5a7';
--   update public.pedidos_artes set setor='LASER', prazo=null,         hora='15:10:00' where id='694375ec-f0b7-4a68-84f7-8c6802ae8985';
--   update public.pedidos_artes set setor='LASER', prazo='2026-08-11', hora='17:00:00' where id='42cedf85-0731-4453-b7ae-24f92c71fa58';
--   -- 2. recria as 7 linhas apagadas (id, id_int, setor, prazo, hora, status, created_at):
--   insert into public.pedidos_artes (id, id_int, setor, prazo, hora, status, created_at) values
--     ('458db086-cb2a-4e0e-adca-7cb12fa13dbf',20382,'FLEXO','2026-08-10','15:00:00','APROVADO','2026-08-10 15:20:05.101364+00'),
--     ('d92d4392-7f84-47fd-a805-49ed35aa044c',20413,'FLEXO','2026-08-10','23:00:00','APROVADO','2026-08-10 21:56:01.991301+00'),
--     ('132ce94f-87f7-426e-9501-869573cb3e78',20440,'FLEXO','2026-08-11','15:00:00','APROVADO','2026-08-11 15:12:55.173639+00'),
--     ('b82efe43-a5ca-45fe-a0dc-5b50bcf0b4fb',20464,'FLEXO','2026-08-12','15:00:00','EM ARTE','2026-08-11 17:05:29.099716+00'),
--     ('cdc466fa-aed3-4e6b-82e7-953315d674c9',20508,'PVC',  '2026-08-13','16:00:00','APROVADO','2026-08-13 14:17:04.327578+00'),
--     ('78e56a5d-3ae7-442c-8e21-b14436e60f17',20508,'FLEXO','2026-08-14','15:00:00','APROVADO','2026-08-13 17:59:16.006331+00'),
--     ('6cf2aad3-5364-423f-9638-912c0c7e58cc',20508,'TEXTIL','2026-08-14','16:00:00','APROVADO','2026-08-13 17:59:51.67606+00');
--   -- 3. devolve a coluna de fase e derruba a tabela nova:
--   alter table public.pedidos_artes add column if not exists status_producao text, add column if not exists status_producao_em timestamptz;
--   drop table if exists public.propostas_os_setores;
--
-- ANTES DE APLICAR — verificacao (somente leitura)
--
--     select id, id_int, setor, prazo, hora, status,
--            (coalesce(storage_path,'')<>'' or jsonb_array_length(coalesce(arquivos,'[]'::jsonb))>0) as tem_arquivo
--     from public.pedidos_artes where setor is not null order by id_int;
--
-- DEPOIS DE APLICAR
--
--     select id_int, setor, prazo, hora, status_producao from public.propostas_os_setores order by id_int, setor;
--     select count(*) as sobrou_boletim_em_artes from public.pedidos_artes where setor is not null;  -- 0

create table if not exists public.propostas_os_setores (
  id uuid primary key default gen_random_uuid(),
  id_int integer not null,
  -- Conveniencia: a OS pode nao existir ainda quando o setor e aberto, por isso
  -- e anulavel. O vinculo forte do ERP inteiro continua sendo id_int.
  id_os uuid references public.propostas_os(id) on delete set null,
  setor text not null,
  prazo date,
  hora time without time zone,
  status_producao text,
  status_producao_em timestamptz,
  -- Conferencia/revisao do setor (o que era [Conferencia:SETOR] no obs).
  peso_real_kg numeric,
  qtd_volumes integer,
  tipo_volume text,
  responsavel_conferencia text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint propostas_os_setores_setor_check
    check (setor in ('PVC', 'LASER', 'FLEXO', 'TEXTIL')),
  constraint propostas_os_setores_status_producao_check
    check (
      status_producao is null
      or status_producao in (
        'EM PRODUCAO',
        'EM IMPRESSAO',
        'EM IMPRESSAO / PENDENTE',
        'EM ACABAMENTO',
        'EM ACABAMENTO / PENDENTE',
        'CONCLUIDO'
      )
    ),
  -- Um boletim por setor por pedido. E a regra que a tela ja assume.
  constraint propostas_os_setores_id_int_setor_key unique (id_int, setor)
);

comment on table public.propostas_os_setores is
  'Boletim de producao de cada setor do pedido (1 linha por setor). Saiu de pedidos_artes em 13/08/2026: la as linhas contavam como evidencia de arte e travavam a liberacao para producao.';
comment on column public.propostas_os_setores.status_producao is
  'Fase do setor. Mesmo vocabulario de public.osqr__status_qr() ate o acabamento, mais CONCLUIDO. NULL le como EM PRODUCAO. Expedicao e do pedido, nao do setor.';
comment on column public.propostas_os_setores.peso_real_kg is
  'Peso aferido pelo setor, em kg (o campo da tela e "Peso Real (kg)").';

alter table public.propostas_os_setores enable row level security;

-- Mesmo alcance das telas de producao: usuario autenticado. Sem politica anon —
-- o QR publico nunca le tabela direto, so RPC SECURITY DEFINER.
drop policy if exists propostas_os_setores_select_authenticated on public.propostas_os_setores;
create policy propostas_os_setores_select_authenticated
  on public.propostas_os_setores for select to authenticated using (true);

drop policy if exists propostas_os_setores_insert_authenticated on public.propostas_os_setores;
create policy propostas_os_setores_insert_authenticated
  on public.propostas_os_setores for insert to authenticated with check (id_int is not null);

drop policy if exists propostas_os_setores_update_authenticated on public.propostas_os_setores;
create policy propostas_os_setores_update_authenticated
  on public.propostas_os_setores for update to authenticated using (id_int is not null) with check (id_int is not null);

drop policy if exists propostas_os_setores_delete_authenticated on public.propostas_os_setores;
create policy propostas_os_setores_delete_authenticated
  on public.propostas_os_setores for delete to authenticated using (id_int is not null);

-- 1. Copia os boletins de setor que estavam em pedidos_artes.
insert into public.propostas_os_setores (id_int, id_os, setor, prazo, hora, status_producao, status_producao_em, created_at)
select
  a.id_int,
  (select o.id from public.propostas_os o where o.id_int = a.id_int order by o.data_pedido nulls last limit 1),
  upper(trim(a.setor)),
  a.prazo,
  a.hora,
  a.status_producao,
  a.status_producao_em,
  a.created_at
from public.pedidos_artes a
where a.setor is not null
  and upper(trim(a.setor)) in ('PVC', 'LASER', 'FLEXO', 'TEXTIL')
on conflict (id_int, setor) do nothing;

-- 2. Apaga as linhas que eram SO boletim — nunca as que tem arte ou briefing.
delete from public.pedidos_artes a
where a.setor is not null
  and coalesce(a.storage_path, '') = ''
  and jsonb_array_length(coalesce(a.arquivos, '[]'::jsonb)) = 0
  and a.nome_evento is null
  and a.data_evento is null
  and a.designer_uid is null
  and a.designer_nome is null
  and coalesce(a.observacoes::text, '{}') in ('{}', 'null', '')
  and coalesce(a.comentarios_revisao, '') = ''
  and coalesce(a.entrega_dados, '') = '';

-- 3. Nas que sobraram (arte de verdade), limpa o que era do boletim.
update public.pedidos_artes
   set setor = null, prazo = null, hora = null
 where setor is not null or prazo is not null or hora is not null;

-- 4. A fase de producao passou a morar na tabela nova.
alter table public.pedidos_artes
  drop constraint if exists pedidos_artes_status_producao_check;
alter table public.pedidos_artes
  drop column if exists status_producao,
  drop column if exists status_producao_em;
