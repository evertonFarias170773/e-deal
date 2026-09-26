-- Indice em clientes(data_cadastro) para o bloco de clientes novos do /dashboard
--
-- Autorizado pelo dono em 26/09/2026, so para esta escrita.
--
-- rpc_dashboard_executivo conta clientes novos por data_cadastro. Sem indice,
-- cada chamada lia as 66 mil linhas (72 MB) de clientes, que nao cabem no
-- cache, e levava de 0,4 s a 1,5 s. Com o indice: 0,38 ms, 201 paginas.
--
-- APLICADO FORA DE TRANSACAO, como comando unico, em 26/09/2026:
-- CREATE INDEX CONCURRENTLY e proibido dentro de BEGIN/COMMIT. Por isso nao
-- aparece no historico de migrations do Supabase. Se for reaplicar, rode a
-- linha abaixo sozinha.

create index concurrently if not exists idx_clientes_data_cadastro on public.clientes (data_cadastro);
