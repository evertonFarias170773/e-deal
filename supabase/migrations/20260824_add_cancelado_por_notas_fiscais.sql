-- 20260824_add_cancelado_por_notas_fiscais.sql
--
-- O QUE: adiciona cancelado_por (uuid) e cancelado_por_nome (text) em
-- public.notas_fiscais.
--
-- POR QUE: hoje notas_fiscais registra apenas data_cancelamento. Nao ha coluna
-- de autoria do cancelamento. As colunas criado_por e criado_por_nome existentes
-- sao de quem criou o rascunho e nao podem ser reaproveitadas: sobrescreve-las
-- apagaria a autoria da criacao. A autoria do cancelamento vive somente em
-- notas_eventos, que ja se provou fragil neste projeto -- os tres cancelamentos
-- registrados ficaram orfaos apos a limpeza do historico. Com emissao em
-- producao, quem cancelou passa a ser informacao fiscal, e precisa estar na
-- propria nota.
--
-- ESCOPO: aditivo. Colunas nullable, sem default, sem backfill, sem indice.
-- Nenhuma linha existente e alterada. Nenhuma policy, grant ou trigger e tocada.
-- Nenhum codigo depende destas colunas ainda: a rota de cancelamento que as
-- preenche vem em tarefa seguinte.

ALTER TABLE public.notas_fiscais
  ADD COLUMN IF NOT EXISTS cancelado_por uuid,
  ADD COLUMN IF NOT EXISTS cancelado_por_nome text;

COMMENT ON COLUMN public.notas_fiscais.cancelado_por IS
  'auth.users.id de quem executou o cancelamento. Preenchido pela rota de servidor a partir da sessao. Nulo em notas nao canceladas e em cancelamentos anteriores a esta coluna.';

COMMENT ON COLUMN public.notas_fiscais.cancelado_por_nome IS
  'Nome do autor do cancelamento no momento do evento. Snapshot: nao acompanha alteracao posterior do cadastro do usuario.';

-- VERIFICACOES (rodar depois de aplicar)
--
-- 1) as duas colunas existem, sao nullable e sem default:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'notas_fiscais'
--    AND column_name IN ('cancelado_por','cancelado_por_nome');
--
-- 2) nenhuma linha foi alterada -- ambas totalmente nulas:
-- SELECT count(*) AS total,
--        count(cancelado_por) AS com_autor,
--        count(cancelado_por_nome) AS com_nome
--   FROM public.notas_fiscais;
--
-- 3) criado_por segue intacto:
-- SELECT count(*) AS total, count(criado_por) AS com_criado_por
--   FROM public.notas_fiscais;

-- ROLLBACK
--
-- ALTER TABLE public.notas_fiscais
--   DROP COLUMN IF EXISTS cancelado_por,
--   DROP COLUMN IF EXISTS cancelado_por_nome;
--
-- Seguro enquanto nenhum codigo publicado ler ou escrever nestas colunas.
-- Depois que a rota de cancelamento estiver em producao, o rollback derruba a
-- autoria e exige reverter o codigo antes.
