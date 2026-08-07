-- Unicidade de parcela passa a considerar somente boletos ATIVOS
--
-- REGRA
--   No maximo um boleto NAO CANCELADO por (id_int, parcela).
--   Boleto CANCELADO permanece como historico e deixa de ocupar a parcela,
--   liberando refaturamento. Boleto ativo continua bloqueando duplicidade.
--
-- PROBLEMA QUE MOTIVOU
--   `boletos_unico_parcela UNIQUE (id_int, parcela)` nao recorta por status,
--   entao um boleto cancelado travava a parcela para sempre. A tela ja tratava
--   cancelado como reemitivel, e o INSERT estourava no Postgres com a mensagem
--   crua da constraint. Medido em producao em 06/08/2026: a proposta 20087 tem
--   a parcela 1 ocupada por um boleto CANCELADO desde 04/08 (id
--   d7d2cdb9-3982-4431-a254-c31b4f7c7cec), e nenhum lancamento novo passava.
--
-- O PREDICADO
--   `upper(status) is distinct from 'CANCELADO'`, e nao `<> 'CANCELADO'`.
--   Com `<>`, linha de status NULO sairia do indice e escaparia da protecao;
--   com `is distinct from`, status nulo conta como ATIVO — o lado seguro.
--   `upper()` e IMMUTABLE, entao e valido em predicado de indice.
--
--   A validacao em src/features/cobrancas/PrepararBoletosModal.tsx normaliza
--   exatamente igual (`String(status || "").toUpperCase() !== "CANCELADO"`),
--   inclusive para nulo. Divergir entre aplicacao e banco foi a causa do bug
--   original; se um lado mudar, o outro tem de mudar junto.
--
-- ANTES DE APLICAR — verificacao obrigatoria
--   O indice unico so e criado se nao houver colisao ATIVA. Rode:
--
--     select id_int, parcela, count(*) as ativos,
--            array_agg(id order by created_at)                       as ids,
--            array_agg(coalesce(status, '(nulo)') order by created_at) as status
--       from public.boletos
--      where upper(status) is distinct from 'CANCELADO'
--      group by id_int, parcela
--     having count(*) > 1
--      order by id_int, parcela;
--
--   Esperado: ZERO linhas. Se vier alguma, sao duas cobrancas ativas para a
--   mesma parcela — decisao caso a caso antes de aplicar, NAO resolver apagando.
--
--   EXECUTADO em producao em 06/08/2026: ZERO linhas. Base com 567 boletos,
--   561 ativos e 6 cancelados. A constraint atual foi conferida no banco vivo
--   (`UNIQUE (id_int, parcela)`). Reexecutar antes de aplicar, porque o estado
--   pode mudar entre a verificacao e a aplicacao.
--
-- NAO FAZ
--   Nao apaga cancelados, nao altera cobranca existente, nao mexe em
--   pagamentos_v2, propostas, RLS, permissoes ou qualquer dado.
--
-- REVERSAO
--   drop index if exists public.boletos_unico_parcela_ativo;
--   alter table public.boletos
--     add constraint boletos_unico_parcela unique (id_int, parcela);
--   A volta so funciona enquanto nao existir parcela com um cancelado mais um
--   ativo — que e justamente o estado que esta migration passa a permitir.

begin;

-- 1. Sai a unicidade cega. O indice de apoio cai junto com a constraint.
alter table public.boletos
  drop constraint if exists boletos_unico_parcela;

-- 2. Entra a unicidade condicional, restrita aos boletos ativos.
create unique index if not exists boletos_unico_parcela_ativo
  on public.boletos (id_int, parcela)
  where upper(status) is distinct from 'CANCELADO';

comment on index public.boletos_unico_parcela_ativo is
  'No maximo um boleto ATIVO por (id_int, parcela). Cancelado fica como historico e nao ocupa a parcela, permitindo refaturamento. Status nulo conta como ativo. A validacao em PrepararBoletosModal usa a mesma normalizacao — manter os dois lados em sincronia.';

commit;
