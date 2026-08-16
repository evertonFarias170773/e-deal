-- expedicoes — dados de EXECUÇÃO da expedição (1 linha por pedido/id_int)
--
-- O QUE E
--   O que o expedidor grava ao operar: peso aferido do pacote, volumes,
--   transportadora definida na hora, rastreio, prepostagem dos Correios e as
--   datas de pronto/despacho/entrega.
--
-- POR QUE
--   O status oficial do pedido continua em propostas.status_interno (fluxo
--   EXPEDICAO -> A RETIRAR | EM TRANSITO -> ENTREGUE, doc
--   FLUXO-OFICIAL-STATUS-PROPOSTAS.md secao 6.13). Mas nao havia onde gravar a
--   execucao: propostas.peso e smallint (estoura em ~32kg), cotacao_frete e
--   historico de cotacao (nao deve ser mutado) e propostas_os so tem o rastreio.
--   O rastreio continua espelhado em propostas_os.codigo_rastreamento para as
--   telas legadas.
--
-- OS_STATUS_LOG
--   A tabela ja existia com RLS ligado e ZERO policies: so as RPCs SECURITY
--   DEFINER do QR publico conseguiam escrever. A Expedicao do ERP registra as
--   transicoes direto (origem='EXPEDICAO_UI'), entao ganha policy de INSERT
--   para authenticated. Sem SELECT/UPDATE/DELETE: trilha de auditoria e
--   escrita-e-esquecida do lado do client.
--
-- ROLLBACK
--   drop policy if exists os_status_log_insert_authenticated on public.os_status_log;
--   drop table if exists public.expedicoes;

create table if not exists public.expedicoes (
  id bigint generated always as identity primary key,
  id_int integer not null unique,
  -- Categoria normalizada definida no despacho:
  -- CORREIOS | MOTOBOY | TRANSPORTADORA | RETIRA_BALCAO | SEM_CUSTO | INDEFINIDO
  tipo_frete text,
  transportadora_nome text,
  id_transportadora_cliente integer references public.clientes (id_cliente),
  peso_kg numeric,
  qtd_volumes integer,
  tipo_volume text,
  id_endereco_entrega uuid references public.enderecos (id),
  codigo_rastreamento text,
  correios_id_prepostagem text,
  correios_codigo_objeto text,
  data_pronto timestamptz,
  data_despacho timestamptz,
  data_entrega timestamptz,
  despachado_por text,
  retirado_por text,
  obs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expedicoes_tipo_frete_check check (
    tipo_frete is null or tipo_frete in
      ('CORREIOS','MOTOBOY','TRANSPORTADORA','RETIRA_BALCAO','SEM_CUSTO','INDEFINIDO')
  ),
  constraint expedicoes_tipo_volume_check check (
    tipo_volume is null or tipo_volume in ('Pacote','Caixa','Envelope','Outro')
  )
);

comment on table public.expedicoes is
  'Execucao da expedicao (1 linha por id_int): peso aferido, volumes, transportadora definida, rastreio, prepostagem Correios e datas. Status oficial permanece em propostas.status_interno.';
comment on column public.expedicoes.peso_kg is
  'Peso aferido na expedicao, em KG (cotacao_frete.peso e em gramas).';

alter table public.expedicoes enable row level security;

-- Mesmo alcance das telas internas (padrao de propostas_os_setores): usuario
-- autenticado. Sem policy anon e sem DELETE (linha de expedicao nao se apaga).
drop policy if exists expedicoes_select_authenticated on public.expedicoes;
create policy expedicoes_select_authenticated
  on public.expedicoes for select to authenticated using (true);

drop policy if exists expedicoes_insert_authenticated on public.expedicoes;
create policy expedicoes_insert_authenticated
  on public.expedicoes for insert to authenticated with check (id_int is not null);

drop policy if exists expedicoes_update_authenticated on public.expedicoes;
create policy expedicoes_update_authenticated
  on public.expedicoes for update to authenticated
  using (id_int is not null) with check (id_int is not null);

-- Trilha de transicoes: a Expedicao do ERP escreve direto no log.
drop policy if exists os_status_log_insert_authenticated on public.os_status_log;
create policy os_status_log_insert_authenticated
  on public.os_status_log for insert to authenticated with check (id_int is not null);
