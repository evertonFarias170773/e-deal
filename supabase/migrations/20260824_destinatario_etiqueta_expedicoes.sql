-- 20260824_destinatario_etiqueta_expedicoes.sql
--
-- O QUE: adiciona public.expedicoes.id_cliente_destinatario_etiqueta (integer),
-- que registra em nome de qual cadastro a etiqueta deve sair.
--
-- POR QUE: quando o pagador (propostas.id_faturado) difere do cliente da
-- proposta, o nome que deve figurar como destinatario na etiqueta varia caso a
-- caso -- as vezes o cliente, as vezes o pagador. Hoje o nome sai sempre do
-- cliente da proposta, mesmo quando o endereco escolhido pertence ao pagador.
-- O pedido 21078 e o exemplo: destinatario LISITON (cliente 8469) num endereco
-- de Itabuna que pertence ao cadastro 122, o pagador.
--
-- A escolha passa a ser feita no modal Despachar. Ela precisa ser persistida
-- porque as etiquetas sao geradas por rotas que leem o banco, fora do modal, e
-- podem ser reimpressas dias depois sem passar por ele.
--
-- GUARDA O ID, NAO O PAPEL: registra-se o id_cliente escolhido, nao um rotulo
-- "cliente" ou "pagador". Se o pagador da proposta mudar depois, a etiqueta
-- continua saindo em nome de quem foi escolhido no momento do despacho. E o
-- mesmo criterio de snapshot que o projeto ja usa em proposta fechada, e o mesmo
-- paralelo de expedicoes.id_endereco_entrega, que guarda o id do endereco e nao
-- a regra que o elegeu.
--
-- NULO SIGNIFICA COMPORTAMENTO ATUAL: sem escolha registrada, o destinatario
-- continua sendo o cliente da proposta, exatamente como hoje. Nenhuma etiqueta
-- ja emitida muda de comportamento por causa desta coluna.
--
-- SEM FK, DE PROPOSITO: enderecos.id_cliente e integer e clientes.id_cliente e a
-- chave de negocio, mas o projeto nao mantem FK entre expedicoes e clientes.
-- Criar uma aqui introduziria acoplamento que nao existe no restante da tabela.
-- A aplicacao valida que o id escolhido e o do cliente da proposta ou o do
-- pagador.
--
-- ESCOPO: aditivo. Coluna nullable, sem default, sem backfill, sem indice.
-- Nenhuma linha existente e alterada. Nenhuma policy, constraint ou trigger e
-- tocada. Nenhum codigo depende dela ainda: o campo no modal e a leitura pelas
-- rotas de etiqueta sao tarefa seguinte.
--
-- CONTEXTO DE DADO na data desta migration: public.expedicoes tem 25 linhas,
-- nenhuma trigger e 3 policies. Nenhuma sera alterada aqui.

ALTER TABLE public.expedicoes
  ADD COLUMN IF NOT EXISTS id_cliente_destinatario_etiqueta integer;

COMMENT ON COLUMN public.expedicoes.id_cliente_destinatario_etiqueta IS
  'clientes.id_cliente em cujo nome a etiqueta deve sair, escolhido no modal Despachar quando o pagador difere do cliente da proposta. Snapshot: guarda o id escolhido, nao o papel. Nulo = comportamento padrao, destinatario e o cliente da proposta.';

-- VERIFICACOES (rodar depois de aplicar)
--
-- 1) a coluna existe, e nullable e sem default:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'expedicoes'
--    AND column_name = 'id_cliente_destinatario_etiqueta';
--
-- 2) nenhuma linha foi alterada -- coluna totalmente nula:
-- SELECT count(*) AS total,
--        count(id_cliente_destinatario_etiqueta) AS com_destinatario
--   FROM public.expedicoes;
--
-- 3) a tabela segue sem trigger, e as policies como estavam (3):
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'public.expedicoes'::regclass AND NOT tgisinternal;
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'expedicoes';

-- ROLLBACK
--
-- ALTER TABLE public.expedicoes
--   DROP COLUMN IF EXISTS id_cliente_destinatario_etiqueta;
--
-- Seguro enquanto nenhum codigo publicado ler ou escrever nesta coluna. Depois
-- que a escolha estiver em producao, o rollback faz toda etiqueta voltar a sair
-- em nome do cliente da proposta, e exige reverter o codigo antes.
