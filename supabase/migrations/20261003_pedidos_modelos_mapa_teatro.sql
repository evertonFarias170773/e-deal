-- ============================================================================
-- pedidos_modelos: vínculo do modelo com o Mapa de Teatro
-- 03/10/2026 — decisão do dono.
--
-- O botão "Mapa Teatro" da aba Pedido cria um modelo por SETOR de um mapa
-- cadastrado em `public.producao_mapas_teatro` (id uuid, name, config jsonb,
-- created_at). Os setores vivem no JSON, em `config.setores[]` — não há tabela
-- de setor, e `total_lugares` / `lugares_por_setor` não existem no banco.
--
-- AS QUATRO COLUNAS (todas nulas, sem default: modelo que não é de teatro fica
-- exatamente como sempre foi)
--   mapa_teatro_id        uuid   o mapa (mesmo tipo de producao_mapas_teatro.id)
--   mapa_teatro_setor_id  text   o `id` do setor dentro de config.setores[]
--   mapa_teatro_revisao   text   SHA-256 (hex) do JSON canônico da config do
--                                mapa no momento do vínculo — RFC 8785 (JCS):
--                                chaves ordenadas, sem espaços, UTF-8
--   mapa_teatro_snapshot  jsonb  retrato do setor no momento do vínculo: ids e
--                                nomes do mapa e do setor, as cadeiras (chave
--                                de posição, prefixo, num e tipo, sem
--                                renumerar) e os tipos de assento usados
--
-- O vínculo é SEMPRE por id (mapa + setor), nunca por nome nem por posição.
--
-- SEM CHAVE ESTRANGEIRA, de propósito: os mapas são mantidos por outro sistema,
-- e uma FK passaria a impedir que ele apague ou recrie um mapa. O snapshot é o
-- que preserva o que foi vendido.
--
-- ADITIVA E NÃO DESTRUTIVA: só ADD COLUMN de colunas nulas. Conferido antes de
-- aplicar (03/10/2026): nenhuma view depende de `pedidos_modelos`; nenhuma
-- função insere nela sem lista de colunas; os seis gatilhos da tabela não
-- reescrevem `nome_modelo` nem `quantidade` e não listam colunas. A única
-- função com %ROWTYPE da tabela (`link_cliente_bancos_modelos`) devolve chaves
-- escolhidas a dedo, não a linha. RLS e permissões não são tocadas.
--
-- ROLLBACK (não destrói nada além do próprio vínculo):
--   alter table public.pedidos_modelos
--     drop column if exists mapa_teatro_snapshot,
--     drop column if exists mapa_teatro_revisao,
--     drop column if exists mapa_teatro_setor_id,
--     drop column if exists mapa_teatro_id;
-- ============================================================================

alter table public.pedidos_modelos
  add column if not exists mapa_teatro_id uuid,
  add column if not exists mapa_teatro_setor_id text,
  add column if not exists mapa_teatro_revisao text,
  add column if not exists mapa_teatro_snapshot jsonb;

comment on column public.pedidos_modelos.mapa_teatro_id is
  'Mapa de Teatro (producao_mapas_teatro.id) de onde o modelo nasceu. Nulo = modelo que nao e de teatro.';
comment on column public.pedidos_modelos.mapa_teatro_setor_id is
  'id do setor dentro de producao_mapas_teatro.config.setores[]. Vinculo por id, nunca por nome ou posicao.';
comment on column public.pedidos_modelos.mapa_teatro_revisao is
  'SHA-256 (hex minusculo) do JSON canonico (RFC 8785) da config do mapa no momento do vinculo.';
comment on column public.pedidos_modelos.mapa_teatro_snapshot is
  'Retrato do setor no momento do vinculo: mapa, setor, cadeiras (chave, prefixo, num, tipo) e tipos de assento usados.';
