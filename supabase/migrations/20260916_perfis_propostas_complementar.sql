-- Pedido complementar, Etapa E10 — concede `propostas.complementar` aos perfis
-- Administrador (id 2) e Vendedor (id 4)
--
-- Plano: docs/superpowers/plans/2026-09-13-pedido-complementar.md (secao 3.3 e E10)
-- Regra: docs/business/PEDIDO-COMPLEMENTAR.md (decisao 10)
-- Molde: 20260813_perfil_financeiro_editar_faturado.sql
--
-- O QUE E
--   Acrescenta a chave `propostas.complementar` ao JSONB `perfis.permissoes` dos
--   perfis 2 (Administrador) e 4 (Vendedor), escolhidos pelo dono em 13/09/2026.
--   E a ultima etapa do recurso: ate aqui a chave existia no catalogo da tela e
--   nos fallbacks legados, mas nenhum perfil a tinha. So a alcancavam o coringa
--   `*` do Super Administrador e, no banco, quem tem `usuarios.is_admin = true`
--   (fallback de `cc__assert_permissao`, aceito pelo dono e nao alterado).
--
-- O QUE A CHAVE LIBERA
--   - o item "Criar pedido complementar" no menu da lista de Orcamentos;
--   - a funcao `criar_pedido_complementar`;
--   - as rotas `/api/orcamentos/complementar/cotar-frete` e `/aplicar-frete` e a
--     funcao `complementar_aplicar_frete`;
--   - o cancelamento do complemento com carimbo do ledger em origem COMERCIAL
--     (`desvincular_pedido_complementar` tambem aceita `propostas.cancel`).
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO sobrescreve permissao nenhuma: o operador `||` so ACRESCENTA ao array.
--   NAO duplica: o `where` pula o perfil que ja tiver a chave.
--   NAO concede a Financeiro (3), Gerente, Producao, Designer, Operador,
--   Expedidor, Acesso Pendente nem Super Administrador: so `id in (2, 4)`.
--   NAO altera `cc__assert_permissao`, funcao, trigger, view, RLS nem grant.
--   NAO toca coluna alem de `permissoes` — com UMA ressalva: o trigger
--   `perfis_set_timestamp` (BEFORE UPDATE, `trigger_set_timestamp`) grava
--   `data_atualizacao = now()` em toda linha atualizada. E o efeito normal de
--   qualquer edicao de perfil, inclusive pela tela, e foi aceito pelo dono em
--   14/09/2026. O trigger NAO e desligado.
--
-- GUARDA
--   Aborta a transacao inteira se o UPDATE atingir numero de linhas diferente
--   de 2. Por isso a reexecucao depois de aplicada ABORTA de proposito (0
--   linhas): a chave ja esta la e nada deve ser gravado de novo.
--
-- ANTES DE APLICAR — verificacao (somente leitura)
--
--     select id, nome, permissoes @> '["propostas.complementar"]'::jsonb as ja_tem,
--            md5(permissoes::text) as md5_perm
--       from public.perfis order by id;
--
--   Esperado em 14/09/2026: 9 perfis, nenhum com a chave; perfil 2 com 73
--   permissoes, perfil 4 com 25.
--
-- VERIFICACAO (rodar depois de aplicar)
--
--     select id, nome, jsonb_array_length(permissoes) as qtd,
--            permissoes @> '["propostas.complementar"]'::jsonb as tem,
--            md5(permissoes::text) as md5_perm
--       from public.perfis order by id;
--
--   Esperado: perfis 2 e 4 com `tem = true` e uma permissao a mais (74 e 26);
--   os outros 7 com o mesmo md5 de antes.
--
-- ROLLBACK (remove so esta chave dos dois perfis; tambem dispara o trigger)
--
--     update public.perfis
--        set permissoes = permissoes - 'propostas.complementar'
--      where id in (2, 4);

do $$
declare
  v_linhas integer;
begin
  update public.perfis
     set permissoes = permissoes || '["propostas.complementar"]'::jsonb
   where id in (2, 4)
     and not (permissoes @> '["propostas.complementar"]'::jsonb);

  get diagnostics v_linhas = row_count;

  if v_linhas <> 2 then
    raise exception 'ABORTADO: o grant de propostas.complementar atingiria % linha(s); esperado 2 (perfis 2 e 4 sem a chave).', v_linhas;
  end if;
end;
$$;
