-- 20260824_add_cancelamento_notas_servico.sql
--
-- O QUE: adiciona data_cancelamento (timestamptz), cancelado_por (uuid) e
-- cancelado_por_nome (text) em public.notas_servico.
--
-- POR QUE: a rota /api/fiscal/cancelar-nfe cobre NF-e e NFS-e, mas a NFS-e
-- ficou sem trava de duplicidade porque notas_servico nao tem coluna onde
-- reservar o cancelamento. Em notas_fiscais o compare-and-swap condiciona em
-- status = 'AUTORIZADA' e data_cancelamento IS NULL, gravando a reserva antes
-- de chamar o webhook. Sem coluna equivalente, duas chamadas simultaneas
-- alcancam o webhook duas vezes.
--
-- As colunas existentes nao servem: criado_por_nome e de quem criou o rascunho
-- e sobrescreve-la apagaria a autoria da criacao; ultima_tentativa_em e
-- tentativas_envio sao do envio, e usa-las misturaria dois eventos na mesma
-- coluna. notas_servico nao tem criado_por (uuid) -- so o nome --, diferente de
-- notas_fiscais; esta migration nao corrige essa assimetria.
--
-- ESCOPO: aditivo. Colunas nullable, sem default, sem backfill, sem indice.
-- Nenhuma linha existente e alterada. Nenhuma policy, constraint ou trigger e
-- tocada. O unico trigger da tabela,
-- trg_nfse_normalizar_recalcular_biu, dispara por UPDATE OF de campos
-- tributarios e de valor, e nao lista status nem coluna de data -- portanto nao
-- e acionado por esta migration nem pela escrita futura da reserva.
--
-- NAO RESOLVE, e continua de pe depois de aplicada: o bloco de persistencia do
-- cancelamento na tela esta desligado para NFS-e por `if (client && !isNfse)`
-- em NotasFiscaisPage.tsx:745, e o ERP nao possui nenhum update ou insert em
-- notas_servico -- a tabela e escrita apenas pelo n8n. Hoje uma NFS-e cancelada
-- na prefeitura segue exibida como AUTORIZADA. Fazer a rota escrever status,
-- data e autoria e tarefa seguinte, e depende destas colunas.

ALTER TABLE public.notas_servico
  ADD COLUMN IF NOT EXISTS data_cancelamento timestamptz,
  ADD COLUMN IF NOT EXISTS cancelado_por uuid,
  ADD COLUMN IF NOT EXISTS cancelado_por_nome text;

COMMENT ON COLUMN public.notas_servico.data_cancelamento IS
  'Momento da reserva do cancelamento. Serve de compare-and-swap: a rota condiciona em status AUTORIZADA e data_cancelamento IS NULL. Nulo em notas nao canceladas.';

COMMENT ON COLUMN public.notas_servico.cancelado_por IS
  'auth.users.id de quem executou o cancelamento. Preenchido pela rota de servidor a partir da sessao. Nulo em notas nao canceladas e em cancelamentos anteriores a esta coluna.';

COMMENT ON COLUMN public.notas_servico.cancelado_por_nome IS
  'Nome do autor do cancelamento no momento do evento. Snapshot: nao acompanha alteracao posterior do cadastro do usuario.';

-- VERIFICACOES (rodar depois de aplicar)
--
-- 1) as tres colunas existem, sao nullable e sem default:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'notas_servico'
--    AND column_name IN ('data_cancelamento','cancelado_por','cancelado_por_nome');
--
-- 2) nenhuma linha foi alterada -- as tres totalmente nulas:
-- SELECT count(*) AS total,
--        count(data_cancelamento)  AS com_data,
--        count(cancelado_por)      AS com_autor,
--        count(cancelado_por_nome) AS com_nome
--   FROM public.notas_servico;
--
-- 3) status e criado_por_nome seguem intactos:
-- SELECT status, count(*) AS total, count(criado_por_nome) AS com_criado_por_nome
--   FROM public.notas_servico GROUP BY status ORDER BY total DESC;
--
-- 4) o trigger e as policies seguem como estavam (1 trigger, 2 policies):
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'public.notas_servico'::regclass AND NOT tgisinternal;
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'notas_servico';

-- ROLLBACK
--
-- ALTER TABLE public.notas_servico
--   DROP COLUMN IF EXISTS data_cancelamento,
--   DROP COLUMN IF EXISTS cancelado_por,
--   DROP COLUMN IF EXISTS cancelado_por_nome;
--
-- Seguro enquanto nenhum codigo publicado ler ou escrever nestas colunas.
-- Depois que a rota passar a reservar o cancelamento em notas_servico, o
-- rollback derruba a trava e a autoria, e exige reverter o codigo antes.
