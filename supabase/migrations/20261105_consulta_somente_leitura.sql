-- Perfil Consulta (slug 'consulta') nao grava: politicas RESTRICTIVE de INSERT/UPDATE/DELETE para authenticated.
-- Aplicada 05/11/2026 com autorizacao nominal do dono. So ACRESCENTA: 1 funcao + 3 politicas por tabela (109 tabelas).
-- Nenhuma politica existente muda. Fora, por decisao do dono (05/11):
--   maestro_conversas, maestro_mensagens, maestro_acoes: o Maestro grava com a sessao do usuario
--   etiquetas_entrega, sudeste_capa: sem RLS; politica nao teria efeito
--   views atualizaveis sem security_invoker: gravam como dono da view e passam por cima da RLS

create or replace function public.usuario_eh_perfil_consulta()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.perfis p on p.id = u.id_perfil
    where u.user_id = auth.uid()
      and p.slug = 'consulta'
  );
$$;

revoke all on function public.usuario_eh_perfil_consulta() from public, anon;
grant execute on function public.usuario_eh_perfil_consulta() to authenticated, service_role;

do $$
declare
  t text;
  tabelas text[] := array[
    'Titulo_Tarefa', '_backup_perfis_20260610', 'arquivos_recebidos', 'base_conhecimento_produtos', 'boletos',
    'cadastros_online', 'categorias', 'cidades_veppo', 'clientes', 'clientes_precos_fixos', 'clientes_socios',
    'complementos_frete', 'conta_corrente_pendencias', 'contatos', 'cores', 'cotacao_frete', 'desconto_proposta',
    'descontos', 'dialogo', 'empresas', 'enderecos', 'expedicao_recotacao_liberacoes', 'expedicao_recotacoes',
    'expedicao_reenvios', 'expedicoes', 'feriados', 'fotosProdutos', 'imposition_avisos', 'imposition_avisos_leituras',
    'imposition_fundo_pwa', 'imposition_tempo_no_card', 'modelos_cobranca', 'movimento_credito',
    'nfe_naturezas_operacao', 'nfe_ncm', 'nfse_servicos_padrao', 'notas_eventos', 'notas_fiscais',
    'notas_fiscais_itens', 'notas_fiscais_pagamentos', 'notas_servico', 'origem_produto', 'os_qr_tokens',
    'os_status_log', 'os_temp', 'pagamentos', 'pagamentos_publicos', 'pagamentos_v2', 'pdf_propostas_modelos',
    'pedidos_artes', 'pedidos_artes_status_backup_20260913', 'pedidos_backup', 'pedidos_bancos',
    'pedidos_links_cliente', 'pedidos_modelos', 'pedidos_modelos_banco', 'perfis', 'print_agents', 'print_queue',
    'producao_acesso_bloqueios', 'producao_acesso_contas', 'producao_acesso_credenciais',
    'producao_acesso_dispositivo_setores', 'producao_acesso_dispositivos', 'producao_acesso_entradas_unicas',
    'producao_acesso_eventos', 'producao_acesso_falhas_pareamento', 'producao_acesso_leituras',
    'producao_acesso_pedidos', 'producao_acesso_setores', 'producao_combinacoes', 'producao_config_impressora',
    'producao_cores', 'producao_formatos', 'producao_mapas_teatro', 'producao_modelos_imposicao',
    'producao_numeracoes', 'producao_ordens_servico', 'producao_os_itens', 'producao_os_log',
    'producao_print_config', 'producao_produtos_formatos', 'producao_saidas', 'producao_usuarios',
    'producao_volume_itens', 'producao_volumes', 'produto_boletim_campos', 'produto_variacoes', 'produtos',
    'produtos_proposta', 'produtos_proposta_boletim_campos', 'produtos_proposta_variacao', 'propostas',
    'propostas_chat', 'propostas_chat_mentions', 'propostas_os', 'propostas_os_setores', 'propostas_pendencias',
    'sem_dono', 'sudeste_matriz', 'tarefas', 'tarefas_equipe', 'tarefas_equipe_anexos', 'tarefas_equipe_mensagens',
    'tarefas_equipe_vistos', 'tipos_variacoes', 'transportadoras', 'variacoes', 'versao'
  ];
begin
  foreach t in array tabelas loop
    execute format('create policy consulta_nao_insere on public.%I as restrictive for insert to authenticated with check (not public.usuario_eh_perfil_consulta())', t);
    execute format('create policy consulta_nao_altera on public.%I as restrictive for update to authenticated using (not public.usuario_eh_perfil_consulta()) with check (not public.usuario_eh_perfil_consulta())', t);
    execute format('create policy consulta_nao_apaga on public.%I as restrictive for delete to authenticated using (not public.usuario_eh_perfil_consulta())', t);
  end loop;
end $$;

-- ROLLBACK:
-- do $$ declare t record; begin
--   for t in select tablename from pg_policies where schemaname = 'public' and policyname in ('consulta_nao_insere','consulta_nao_altera','consulta_nao_apaga') loop
--     execute format('drop policy if exists consulta_nao_insere on public.%I', t.tablename);
--     execute format('drop policy if exists consulta_nao_altera on public.%I', t.tablename);
--     execute format('drop policy if exists consulta_nao_apaga on public.%I', t.tablename);
--   end loop; end $$;
-- drop function if exists public.usuario_eh_perfil_consulta();
