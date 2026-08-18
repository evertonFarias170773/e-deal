-- Modalidade do frete e transportadora definida na PROPOSTA (aba Fretes do Orcamento)
--
-- O QUE E
--   Duas colunas aditivas em public.propostas, nulaveis e sem default:
--
--     modalidade_frete           text     RETIRA | FOB | CIF  (CHECK proprio)
--     id_transportadora_cliente  integer  FK -> clientes(id_cliente)
--
--   Guardam o que o VENDEDOR declara no orcamento: quem paga o transporte e,
--   quando o cliente assume (FOB), por qual transportadora cadastrada.
--
-- POR QUE
--   A modalidade nasceu no lugar errado. Hoje ela so existe em
--   `expedicoes.modalidade_frete`, declarada pelo expedidor no despacho — muito
--   depois de a decisao ter sido tomada. Quem sabe se o cliente assume o frete e
--   o vendedor, no momento da venda, e essa informacao precisa atravessar o fluxo
--   ate a Expedicao em vez de ser redescoberta no fim.
--
--   O vocabulario e o MESMO da Expedicao (RETIRA, FOB, CIF), de proposito: as
--   duas pontas falam a mesma lingua e a comparacao entre o que foi vendido e o
--   que foi despachado e direta.
--
--   A transportadora e FK para o cadastro, nao texto livre. Hoje
--   `cotacao_frete` nao tem coluna de transportadora — a tela deriva o nome do
--   texto de `servico` na releitura, e o vinculo com as 24 transportadoras
--   cadastradas (clientes com categoria = TRANSPORTADORA) se perde. A Expedicao
--   ja trabalha com FK (`expedicoes.id_transportadora_cliente`); a proposta passa
--   a falar a mesma coisa, e o despacho recebe o vinculo pronto.
--
-- POR QUE EM `propostas` E NAO EM `cotacao_frete`
--   Modalidade e uma decisao por PROPOSTA, nao por cotacao. E, decisivo:
--   escrever em `cotacao_frete` dispara `trg_recalc_after_frete` e
--   `trg_frete_sync_financeiro`, e este ultimo reescreve `status_interno` —
--   com zero pagamentos, forca 'NOVO' incondicionalmente. `propostas` nao tem
--   nada disso (ver ESCOPO).
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   Estritamente aditiva. Nao altera `cotacao_frete`, nenhum CHECK existente,
--   nenhuma RPC, RLS ou trigger. Sem backfill e sem default: a modalidade nasce
--   quando o vendedor a declara — nao da para inferi-la do texto da cotacao.
--
--   Verificado no banco em 18/08/2026, antes de escrever:
--
--   1. Nao existe coluna equivalente. `public.propostas` tem hoje 52 colunas,
--      das quais so tres tocam frete: `frete_escolhido` (text livre, rotulo de
--      servico — 5.937 nulos e valores como 'Frete Incluso', 'A definir',
--      'SEDEX'/'sedex'), `id_frete` (smallint, praticamente morto: 7.995 nulos)
--      e `valor_frete` (numeric, default 0). Nenhuma guarda modalidade.
--      Os nomes `propostas_modalidade_frete_check` e
--      `propostas_id_transportadora_cliente_fkey` nao estao em uso.
--
--   2. Os 6 triggers de `public.propostas`, e o que cada um faz com colunas novas:
--
--      | trigger                              | momento/eventos      | dispara por      | efeito |
--      |--------------------------------------|----------------------|------------------|--------|
--      | propostas_set_timestamp              | BEFORE UPDATE        | todas as colunas | carimba updated_at |
--      | trg_set_updated_at                   | BEFORE UPDATE        | todas as colunas | carimba updated_at |
--      | tg_propostas_valor_total_avulsa      | BEFORE INSERT/UPDATE | todas as colunas | so age se is_avulso e valor_total nulo/zero; le valor e valor_frete |
--      | tg_registrar_paid_at                 | BEFORE UPDATE        | todas as colunas | so LE status_interno (NEW vs OLD) para carimbar paid_at |
--      | trg_audit_propostas                  | AFTER INSERT/DEL/UPD | todas as colunas | trilha de auditoria (audit.log_row_changes_v2) |
--      | trg_sync_cliente_idcliente_pagamentos| AFTER UPDATE         | cliente, id_cliente | nao dispara por estas colunas |
--
--      Cinco disparam em qualquer UPDATE, inclusive um que toque so as colunas
--      novas — mas NENHUM le ou escreve nelas, e NENHUM reescreve
--      `status_interno`: `tg_registrar_paid_at` apenas compara NEW/OLD, que ficam
--      iguais num update que nao mexe no status. A auditoria passa a registrar as
--      colunas novas, que e o comportamento desejado.
--
--   3. A FK e valida: `clientes.id_cliente` e `integer` e tem restricao unica
--      (`clientes_id_cliente_key`), requisito do alvo de uma foreign key. O tipo
--      da coluna nova acompanha (`integer`). Esta FK e identica a que ja existe
--      em `expedicoes.id_transportadora_cliente`
--      (`expedicoes_id_transportadora_cliente_fkey`), sem clausula ON DELETE —
--      mesma forma, de proposito, para as duas pontas se comportarem igual.
--
--   Estado no momento da escrita: 8.181 linhas em `public.propostas`, 24 clientes
--   com categoria TRANSPORTADORA. Nenhum dado a converter.

alter table public.propostas
  add column if not exists modalidade_frete text;

alter table public.propostas
  add column if not exists id_transportadora_cliente integer;

alter table public.propostas
  drop constraint if exists propostas_modalidade_frete_check;

alter table public.propostas
  add constraint propostas_modalidade_frete_check
  check (modalidade_frete is null or modalidade_frete in ('RETIRA', 'FOB', 'CIF'));

alter table public.propostas
  drop constraint if exists propostas_id_transportadora_cliente_fkey;

alter table public.propostas
  add constraint propostas_id_transportadora_cliente_fkey
  foreign key (id_transportadora_cliente) references public.clientes (id_cliente);

comment on column public.propostas.modalidade_frete is
  'Modalidade comercial do frete declarada pelo VENDEDOR na aba Fretes do orcamento: RETIRA (cliente busca no balcao), FOB (por conta do cliente) ou CIF (por conta do remetente). Mesmo vocabulario de expedicoes.modalidade_frete, que e a declaracao do EXPEDIDOR no despacho e prevalece sobre esta em caso de divergencia. Nula nas linhas anteriores a 18/08/2026.';

comment on column public.propostas.id_transportadora_cliente is
  'Transportadora definida no orcamento, quando a modalidade e FOB. FK para clientes(id_cliente), restrita na tela aos cadastros com categoria = TRANSPORTADORA. Nao ha texto livre: o vinculo existe para o despacho reaproveitar o cadastro. Nula quando a modalidade nao exige transportadora ou em linhas anteriores a 18/08/2026.';

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- a) as duas colunas nasceram nulaveis e sem default
--   select column_name, data_type, is_nullable, coalesce(column_default, '(sem default)') as padrao
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'propostas'
--      and column_name in ('modalidade_frete', 'id_transportadora_cliente');
--
--   -- b) as duas restricoes novas existem, e nenhuma outra de propostas mudou
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.propostas'::regclass
--      and contype in ('c', 'f')
--    order by conname;
--
--   -- c) sem backfill: tudo nulo, e a contagem de linhas nao mudou (8.181)
--   select count(*) as linhas,
--          count(modalidade_frete) as com_modalidade,
--          count(id_transportadora_cliente) as com_transportadora
--     from public.propostas;
--
--   -- d) cotacao_frete intocada: os tres triggers seguem como estavam
--   select tgname, tgenabled
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where c.relname = 'cotacao_frete' and not t.tgisinternal
--    order by tgname;
--
-- ROLLBACK
--   alter table public.propostas
--     drop constraint if exists propostas_id_transportadora_cliente_fkey;
--   alter table public.propostas
--     drop constraint if exists propostas_modalidade_frete_check;
--   alter table public.propostas
--     drop column if exists id_transportadora_cliente;
--   alter table public.propostas
--     drop column if exists modalidade_frete;
