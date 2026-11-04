-- Perfil "Consulta": só leitura, para a conta do FalaTom (04/11/2026).
--
-- Só chaves de visualização conferidas sem gravação. Ficam de fora, de propósito:
--   expedicao.view      -> abrir a etiqueta grava expedicoes.etiqueta_impressa_em
--   admin.usuarios.view -> vira administrador na tela e libera copiar_proposta_v2
--   propostas.view_all  -> copiar_proposta_v2 cria pedido sem propostas.create
--   pedidos.print_os, tarefas.participar e qualquer chave de criar, editar,
--   emitir, processar, cancelar, baixar, estornar ou administrar; nenhum "*".
--
-- Só insere se ainda não existir perfil com o slug consulta. Não mexe em outro
-- perfil, usuário, RLS ou GRANT.

insert into public.perfis (slug, nome, descricao, ativo, permissoes)
select
  'consulta',
  'Consulta',
  'Só leitura, para consulta do FalaTom',
  true,
  '[
    "dashboard.view", "dashboard.view_financeiro", "dashboard.view_producao",
    "cadastros.view", "cadastros.view_socios", "cadastros.view_credito",
    "produtos.view", "variacoes.view", "propostas.view", "pedidos.view",
    "chat.view", "chat.view_all",
    "cobrancas.view", "conferencia.view", "contas_receber.view", "financeiro.view",
    "fiscal.view", "producao.view", "impressao.view",
    "relatorios.view", "relatorios.financeiro", "relatorios.producao",
    "relatorios.vendas_pagas", "relatorios.frete_por_transportadora",
    "relatorios.fretes_despachados_lista", "relatorios.notas_fiscais",
    "relatorios.contas_a_receber", "relatorios.conferencia_pagamentos",
    "relatorios.curva_abc_clientes", "relatorios.vendas_por_cidade",
    "relatorios.conta_corrente_creditos",
    "admin.perfis.view", "config.view"
  ]'::jsonb
where not exists (select 1 from public.perfis where lower(slug) = 'consulta');

-- ROLLBACK
--   Antes, devolver quem estiver no perfil para Acesso Pendente pela tela de usuários.
--   A FK usuarios.id_perfil é ON DELETE SET NULL: apagar com gente dentro deixaria a
--   conta sem perfil, por isso o delete abaixo só age com o perfil vazio.
--   delete from public.perfis where slug = 'consulta'
--     and not exists (select 1 from public.usuarios u where u.id_perfil = perfis.id);
