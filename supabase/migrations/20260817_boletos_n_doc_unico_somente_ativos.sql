-- `n_doc_boleto` unico passa a considerar somente boletos ATIVOS
--
-- POR QUE
--   A Edge Function `boleto-publico?codigo=X` procura o boleto por
--   `n_doc_boleto` — nao por `ext_reference`. Medido em 17/08/2026: boletos com
--   o campo preenchido devolvem o PDF (HTTP 200); os da proposta 20608, com o
--   campo nulo, devolvem 404 "Boleto nao encontrado" mesmo tendo referencia,
--   nosso numero, linha digitavel e codigo do banco corretos.
--
--   Desde a migracao do FlutterFlow para o Vibe (julho/2026), o unico caminho de
--   criacao de titulo faturado e o PrepararBoletosModal, que grava
--   `ext_reference` e NAO grava `n_doc_boleto`. Resultado: todo boleto faturado
--   nasce com o link publico quebrado, nas tres empresas e nos dois bancos.
--   O a vista nao e afetado — a linha dele e criada pelo n8n, que grava o campo.
--
--   Passar o modal a gravar `n_doc_boleto` esbarra em
--   `idx_boletos_n_doc_boleto`, que e UNIQUE sem recorte por status: o valor e
--   deterministico (igual ao `ext_reference`), entao um boleto CANCELADO manteria
--   o dele e refaturar a mesma parcela colidiria. Foi por isso que o campo saiu
--   do fluxo a vista do Inter em 06/08.
--
-- REGRA
--   No maximo um `n_doc_boleto` NAO CANCELADO. Cancelado permanece como
--   historico e deixa de ocupar o valor, liberando refaturamento. E o mesmo
--   desenho ja aplicado em `boletos_unico_parcela_ativo`.
--
-- O PREDICADO
--   `upper(status) is distinct from 'CANCELADO'`, e nao `<>`: com `<>`, linha de
--   status NULO sairia do indice e escaparia da protecao. `upper()` e IMMUTABLE,
--   portanto valido em predicado de indice. Mesma normalizacao do indice de
--   parcela — os dois tem de continuar coerentes entre si.
--
-- VERIFICADO EM PRODUCAO ANTES DE APLICAR (17/08/2026): ZERO colisoes entre
--   linhas ativas, tanto no estado atual quanto no estado pos-backfill dos 47
--   titulos faturados que tem `ext_reference` e estao sem `n_doc_boleto`.
--
--   Reexecutar antes de aplicar, porque o estado pode mudar no intervalo:
--
--     select n_doc_boleto, count(*)
--       from public.boletos
--      where n_doc_boleto is not null
--        and upper(status) is distinct from 'CANCELADO'
--      group by n_doc_boleto having count(*) > 1;
--
-- NAO FAZ
--   Nao apaga nada, nao altera cobranca existente, nao toca pagamentos_v2,
--   propostas, RLS ou permissoes.
--
-- REVERSAO
--   drop index if exists public.idx_boletos_n_doc_boleto_ativo;
--   create unique index idx_boletos_n_doc_boleto on public.boletos (n_doc_boleto);
--   So funciona enquanto nao existir um cancelado e um ativo com o mesmo valor —
--   que e justamente o estado que esta migration passa a permitir.

begin;

-- 1. Sai a unicidade cega.
drop index if exists public.idx_boletos_n_doc_boleto;

-- 2. Entra a condicional, restrita aos boletos ativos.
create unique index if not exists idx_boletos_n_doc_boleto_ativo
  on public.boletos (n_doc_boleto)
  where upper(status) is distinct from 'CANCELADO';

comment on index public.idx_boletos_n_doc_boleto_ativo is
  'No maximo um n_doc_boleto ATIVO. Cancelado fica como historico e nao ocupa o valor, permitindo refaturamento. Status nulo conta como ativo. Espelha boletos_unico_parcela_ativo — manter os dois coerentes.';

commit;
