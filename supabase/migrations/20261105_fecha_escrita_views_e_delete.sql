-- Fechamento A das regras de acesso (05/11/2026), com autorizacao nominal do dono. So REVOKE.
-- Nenhuma politica criada, alterada ou removida; postgres e service_role nao mudam; leitura (SELECT) continua.
-- Mapa que justifica (05/11): nenhuma tela, rota ou funcao do banco grava pelas nove views nem apaga
-- pagamentos_v2, boletos, clientes ou notas_fiscais com o usuario logado. Os DELETEs dessas tabelas
-- vem do n8n (service_role) e do painel do Supabase.

-- 1. Views gravaveis sem security_invoker (donas postgres): escrita por elas passava por cima da RLS.
revoke insert, update, delete on public.vw_boletos_controle                 from authenticated, anon;
revoke insert, update, delete on public.vw_notas_fiscais_rascunho           from authenticated, anon;
revoke insert, update, delete on public.vw_notas_fiscais_validacao          from authenticated, anon;
revoke insert, update, delete on public.vw_nfe_itens_conferencia_valores    from authenticated, anon;
revoke insert, update, delete on public.vw_produtos_proposta_com_descricao  from authenticated, anon;
revoke insert, update, delete on public.view_pagamentos_pagos               from authenticated, anon;
revoke insert, update, delete on public.view_fotos_por_produtos             from authenticated, anon;
revoke insert, update, delete on public.sudeste_capa_corel                  from authenticated, anon;
revoke insert, update, delete on public.sudeste_capa_export                 from authenticated, anon;

-- 2. DELETE do usuario logado nas tabelas de dinheiro, nota e cadastro.
revoke delete on public.pagamentos_v2 from authenticated;
revoke delete on public.boletos       from authenticated;
revoke delete on public.clientes      from authenticated;
revoke delete on public.notas_fiscais from authenticated;

-- 3. Escrita de anon em notas_fiscais (sem politica, sem efeito pratico; fecha a porta).
revoke insert, update, delete on public.notas_fiscais from anon;

-- ROLLBACK (devolve exatamente o que havia):
-- grant insert, update, delete on public.vw_boletos_controle, public.vw_notas_fiscais_rascunho,
--   public.vw_notas_fiscais_validacao, public.vw_nfe_itens_conferencia_valores,
--   public.vw_produtos_proposta_com_descricao, public.view_pagamentos_pagos, public.view_fotos_por_produtos,
--   public.sudeste_capa_corel, public.sudeste_capa_export to authenticated;
-- grant insert, update, delete on public.view_fotos_por_produtos to anon;
-- grant delete on public.pagamentos_v2, public.boletos, public.clientes, public.notas_fiscais to authenticated;
-- grant insert, update, delete on public.notas_fiscais to anon;
