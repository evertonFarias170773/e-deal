-- 20260824_prepostagem_cancelada_expedicoes.sql
--
-- O QUE: adiciona em public.expedicoes cinco colunas que registram o
-- cancelamento manual de uma prepostagem dos Correios e preservam a anterior:
--   prepostagem_cancelada_em, prepostagem_cancelada_por,
--   prepostagem_cancelada_por_nome,
--   correios_id_prepostagem_anterior, correios_codigo_objeto_anterior.
--
-- POR QUE: nao existe no ERP nenhum caminho para cancelar prepostagem -- nem
-- rota, nem funcao no client dos Correios, nem item de menu. Quando uma etiqueta
-- sai errada, o cancelamento tem de ser feito no portal dos Correios, fora do
-- sistema, e o ERP continua exibindo o rastreio e oferecendo a etiqueta oficial
-- de um objeto que ja nao vale.
--
-- Estas colunas permitem marcar no ERP que o cancelamento ja foi feito no
-- portal, para a tela parar de oferecer rastreio e etiqueta oficial e para o
-- botao de gerar prepostagem reabrir de forma controlada. O cancelamento em si
-- continua sendo manual e fora do ERP: esta migration NAO cria integracao com a
-- API dos Correios.
--
-- POR QUE PRESERVAR A ANTERIOR: hoje gerar uma segunda prepostagem
-- sobrescreveria correios_id_prepostagem e correios_codigo_objeto, e o objeto
-- antigo desapareceria do banco sem deixar rastro -- apagando a prova de que
-- existiu um objeto emitido nos Correios. As colunas _anterior guardam UMA
-- geracao anterior.
--
-- LIMITE DELIBERADO: guarda-se apenas uma anterior. Uma terceira prepostagem
-- para o mesmo pedido deve ser BLOQUEADA pela aplicacao, nunca sobrescrever a
-- coluna _anterior. Perder o rastro de um objeto emitido e pior que travar e
-- exigir decisao humana; um pedido que chega a tres prepostagens tem algo errado
-- que merece ser olhado. O bloqueio e tarefa de aplicacao e nao esta nesta
-- migration.
--
-- ESCOPO: aditivo. Colunas nullable, sem default, sem backfill, sem indice.
-- Nenhuma linha existente e alterada. Nenhuma policy, constraint ou trigger e
-- tocada. Nenhum codigo depende destas colunas ainda.
--
-- CONTEXTO DE DADO na data desta migration: 11 expedicoes possuem
-- correios_id_prepostagem preenchido; dez ja tem data_despacho. Nenhuma sera
-- alterada aqui. A tabela public.expedicoes nao possui trigger de auditoria, e
-- por isso o autor do cancelamento e gravado na propria linha.

ALTER TABLE public.expedicoes
  ADD COLUMN IF NOT EXISTS prepostagem_cancelada_em timestamptz,
  ADD COLUMN IF NOT EXISTS prepostagem_cancelada_por uuid,
  ADD COLUMN IF NOT EXISTS prepostagem_cancelada_por_nome text,
  ADD COLUMN IF NOT EXISTS correios_id_prepostagem_anterior text,
  ADD COLUMN IF NOT EXISTS correios_codigo_objeto_anterior text;

COMMENT ON COLUMN public.expedicoes.prepostagem_cancelada_em IS
  'Momento em que o cancelamento da prepostagem foi MARCADO no ERP. O cancelamento em si e feito no portal dos Correios, fora do sistema. Preenchido significa: nao exibir rastreio nem etiqueta oficial, e liberar nova geracao.';

COMMENT ON COLUMN public.expedicoes.prepostagem_cancelada_por IS
  'auth.users.id de quem marcou o cancelamento no ERP. Preenchido pelo servidor a partir da sessao, nunca por valor vindo do cliente.';

COMMENT ON COLUMN public.expedicoes.prepostagem_cancelada_por_nome IS
  'Nome de quem marcou o cancelamento, no momento da marcacao. Snapshot: nao acompanha alteracao posterior do cadastro do usuario.';

COMMENT ON COLUMN public.expedicoes.correios_id_prepostagem_anterior IS
  'Guarda o correios_id_prepostagem da geracao anterior quando uma nova prepostagem e criada. Guarda apenas UMA anterior: a terceira geracao deve ser bloqueada pela aplicacao, nunca sobrescrever este valor.';

COMMENT ON COLUMN public.expedicoes.correios_codigo_objeto_anterior IS
  'Guarda o correios_codigo_objeto da geracao anterior. Mesmo limite de uma anterior descrito em correios_id_prepostagem_anterior.';

-- VERIFICACOES (rodar depois de aplicar)
--
-- 1) as cinco colunas existem, nullable e sem default:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'expedicoes'
--    AND column_name IN ('prepostagem_cancelada_em','prepostagem_cancelada_por',
--                        'prepostagem_cancelada_por_nome',
--                        'correios_id_prepostagem_anterior',
--                        'correios_codigo_objeto_anterior');
--
-- 2) nenhuma linha foi alterada -- as cinco totalmente nulas:
-- SELECT count(*) AS total,
--        count(prepostagem_cancelada_em)         AS com_data,
--        count(prepostagem_cancelada_por)        AS com_autor,
--        count(prepostagem_cancelada_por_nome)   AS com_nome,
--        count(correios_id_prepostagem_anterior) AS com_prep_anterior,
--        count(correios_codigo_objeto_anterior)  AS com_obj_anterior
--   FROM public.expedicoes;
--
-- 3) as prepostagens vivas seguem intactas -- esperado 11:
-- SELECT count(*) AS com_prepostagem,
--        count(data_despacho) AS ja_despachadas
--   FROM public.expedicoes
--  WHERE correios_id_prepostagem IS NOT NULL;
--
-- 4) a tabela segue sem trigger, e as policies como estavam:
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'public.expedicoes'::regclass AND NOT tgisinternal;
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'expedicoes';

-- ROLLBACK
--
-- ALTER TABLE public.expedicoes
--   DROP COLUMN IF EXISTS prepostagem_cancelada_em,
--   DROP COLUMN IF EXISTS prepostagem_cancelada_por,
--   DROP COLUMN IF EXISTS prepostagem_cancelada_por_nome,
--   DROP COLUMN IF EXISTS correios_id_prepostagem_anterior,
--   DROP COLUMN IF EXISTS correios_codigo_objeto_anterior;
--
-- Seguro enquanto nenhum codigo publicado ler ou escrever nestas colunas.
-- Depois que a marcacao de cancelamento estiver em producao, o rollback derruba
-- o registro do objeto anterior e exige reverter o codigo antes.
