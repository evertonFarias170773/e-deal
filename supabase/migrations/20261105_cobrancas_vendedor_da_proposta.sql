-- Tela Cobrancas: o filtro por vendedor mostra as cobrancas das propostas desse vendedor.
--
-- DECISAO DO DONO (05/11/2026): no filtro por vendedor da tela Cobrancas entram todas as
-- cobrancas das propostas do vendedor dono (propostas.vendedor), quem quer que tenha lancado
-- (ele mesmo, a area do cliente, a Edina ou o financeiro). Mesma regra dos relatorios
-- (20261105_relatorio_vendas_venda_do_dono_da_proposta). Antes o filtro comparava
-- pagamentos_v2.atendente (quem lancou).
--
-- FORMA: coluna calculada do PostgREST. A funcao recebe a linha de pagamentos_v2 e devolve o
-- vendedor dono da proposta; a tela filtra com .eq("vendedor_da_proposta", nome) na mesma
-- consulta de hoje (sem ligacao direta entre pagamentos_v2 e propostas no banco, um filtro
-- embutido nao existe). Proposta sem dono cai em quem lancou, como nos relatorios.
--
-- NAO MUDA: RLS, politicas, GRANT de tabela, nem o que cada usuario ve. A funcao e SECURITY
-- INVOKER (le propostas com as permissoes de quem consulta) e so estreita a lista quando o
-- filtro e usado; sem filtro a consulta da tela e a mesma de antes. Nenhum dado e alterado.
-- EXECUTE: authenticated, service_role e supabase_read_only_user; anon e PUBLIC sem acesso.
--
-- APLICADA em 05/11/2026 (autorizacao nominal do dono). Prova (outubro/2026, servico real da tela):
-- sem filtro 1.595 cobrancas, mesmas linhas antes e depois; Alexandre 219 -> 399 (inclui as duas
-- do 24076, uma lancada pela Edina, e as pagas pela area do cliente), nenhuma de outro vendedor.

create function public.vendedor_da_proposta(p public.pagamentos_v2)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select public.vendedor_nome_do_atendente(pd.vendedor)
       from public.propostas pd
      where pd.id_int = p.id_int
      limit 1),
    public.vendedor_nome_do_atendente(p.atendente));
$$;

comment on function public.vendedor_da_proposta(public.pagamentos_v2) is
  'Vendedor dono da proposta da cobranca (propostas.vendedor); sem dono, quem lancou. Coluna calculada do filtro por vendedor da tela Cobrancas (05/11/2026).';

revoke all on function public.vendedor_da_proposta(public.pagamentos_v2) from public, anon;
grant execute on function public.vendedor_da_proposta(public.pagamentos_v2) to authenticated, service_role, supabase_read_only_user;
