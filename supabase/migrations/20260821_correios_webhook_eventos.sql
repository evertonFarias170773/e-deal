-- Memoria do receiver do webhook dos Correios
--
-- O QUE E
--   Cria `public.correios_webhook_eventos`: uma linha por REQUISICAO recebida em
--   `/api/correios/webhook`, gravada ANTES de qualquer decisao do receiver e
--   atualizada com o desfecho (aceito / assinatura_invalida / objeto_desconhecido
--   / ignorado / erro).
--
-- POR QUE
--   Diagnostico de 21/08/2026: o webhook foi implementado em 17/08, nunca
--   recebeu evento, e nao havia como PROVAR isso pelo banco. Os unicos sinais
--   que o receiver deixava eram `expedicoes.correios_ultimo_evento` (so quando o
--   objeto casava com um pedido) e `os_status_log` (so quando havia transicao de
--   status). Evento recusado por assinatura, evento de objeto que nao e nosso e
--   evento que nunca chegou produziam exatamente o mesmo vestigio: NENHUM.
--   Sobrava `console.warn` no log da Vercel, que expira.
--
--   Sem esta tabela, a proxima investigacao e tao cega quanto foi esta: nao da
--   para distinguir "os Correios nao enviaram" de "enviaram e nos recusamos".
--
-- POR QUE GRAVAR ANTES DE DECIDIR
--   Se o registro fosse feito ao final, o caso mais importante — a requisicao
--   recusada no HMAC — jamais seria gravado, que e justamente o que se quer
--   enxergar quando o segredo da Vercel diverge do segredo cadastrado nos
--   Correios. A linha nasce com `resultado = 'recebido'` e e ATUALIZADA conforme
--   o receiver decide. Linha que fica em 'recebido' significa que o processo
--   morreu no meio (timeout, excecao nao prevista) — e isso tambem e informacao.
--
-- POR QUE NAO E FILA NEM PONTO DE DEDUPLICACAO
--   Esta tabela e OBSERVACAO, nao controle de fluxo. A idempotencia continua
--   onde sempre esteve: no compare-and-swap da transicao
--   (`UPDATE propostas ... WHERE status_interno = <anterior>`), que ja impede
--   duplicar e regredir status. Nada aqui e lido para decidir coisa alguma —
--   por isso a falha de gravacao NAO derruba o processamento do evento (o
--   receiver segue e loga o erro; o evento vale mais que o registro dele).
--
-- SOBRE O CORPO CRU E DADO PESSOAL
--   Guardamos o corpo como veio, porque o formato REAL do payload do wh-rastro
--   so se conhece no primeiro evento verdadeiro e e ele que calibra o parser
--   (o receiver hoje e tolerante justamente por nao conhece-lo).
--
--   O que o rastreio dos Correios carrega, conferido no objeto AD816558575BR em
--   21/08/2026 (NOMES dos campos, nenhum valor):
--     objeto: codObjeto, tipoPostal, dtPrevista, contrato, largura, comprimento,
--             altura, diametro, peso, formato, modalidade, valorDeclarado
--     evento: codigo, tipo, dtHrCriado, descricao, detalhe, comentario,
--             unidade{codSro, tipo, endereco}, unidadeDestino{tipo, endereco}
--   Nenhum campo de pessoa apareceu NESTE objeto. Mas eventos de entrega (BDE)
--   podem trazer `recebedor` (nome e documento de quem recebeu) em outras
--   categorias, e `unidade.endereco` traz localidade. Trate a tabela como
--   contendo dado pessoal por precaucao:
--     - RLS ligada SEM policy: so service_role (que a ignora) enxerga;
--     - GRANTs de anon e authenticated REVOGADOS explicitamente (secao 3);
--     - o receiver trunca o corpo em 20.000 caracteres antes de gravar;
--     - expurgo periodico fica como decisao do dono (ver ROLLBACK/NOTA no fim).
--
-- POR QUE RLS SEM POLICY (e nao o padrao das outras tabelas)
--   `expedicoes`, `os_status_log` e `expedicao_recotacoes` tem RLS ligada COM
--   policy de SELECT para `authenticated`, porque a tela le essas tabelas.
--   Nenhuma tela le esta aqui: quem escreve e le e a rota, por service_role.
--   O precedente exato ja existe em `producao_acesso_eventos` (RLS ligada, zero
--   policies). A diferenca desta migration e ir alem e REVOGAR os grants que o
--   Supabase concede por default privilege — ver secao 3.
--
-- NAO HA TRIGGER DE AUDITORIA AQUI
--   A tabela E o log. Auditar linha a linha um append-only duplicaria o volume
--   sem responder nenhuma pergunta nova.
--
-- APLICACAO
--   APLICADA em producao em 21/08/2026 (schema_migrations 20260821142016).
--   Verificacoes da secao 4 rodadas na sequencia, todas conforme o esperado:
--   9 colunas; relrowsecurity = true com 0 policies; ACL da tabela e da sequence
--   em {postgres,service_role} (sem anon, sem authenticated); os tres indices
--   mais o PK; CHECK com os seis valores; tabela vazia.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. TABELA
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.correios_webhook_eventos (
  id             bigserial PRIMARY KEY,

  -- Quando a requisicao chegou AQUI. O instante do evento nos Correios vive no
  -- corpo e em `expedicoes.correios_ultimo_evento_em`; os dois divergem e a
  -- diferenca entre eles e o atraso da entrega — outra coisa que hoje ninguem
  -- consegue medir.
  recebido_em    timestamptz NOT NULL DEFAULT now(),

  -- Codigo do objeto (AA123456789BR) quando o receiver conseguiu extrair.
  -- NULL enquanto nao extraido, ou quando o corpo nao permitiu reconhecer.
  objeto         text,

  -- Par codigo-tipo COMO VEIO ("BDE-01", "BDE-1"). Cru de proposito: a
  -- normalizacao para as listas de evento e feita em codigo, e guardar o cru e
  -- o que permite descobrir qual grafia os Correios usam de fato.
  tipo_evento    text,

  -- Pedido correspondente, quando o objeto casou com uma linha de `expedicoes`.
  -- Sem FK: o registro do evento nao pode falhar por causa de um objeto que nao
  -- e nosso, e o valor e preenchido depois do INSERT.
  id_int         bigint,

  resultado      text NOT NULL DEFAULT 'recebido'
                 CONSTRAINT correios_webhook_eventos_resultado_check CHECK (
                   resultado IN (
                     'recebido',            -- gravado, ainda sem desfecho
                     'aceito',              -- objeto reconhecido e processado
                     'assinatura_invalida', -- HMAC ausente ou nao confere -> 401
                     'objeto_desconhecido', -- objeto valido, sem pedido nosso
                     'ignorado',            -- sem codigo de objeto no corpo
                     'erro'                 -- falha nossa no processamento
                   )
                 ),

  -- Motivo em texto curto (qual campo faltou, mensagem do erro do banco).
  -- NUNCA recebe segredo, token ou assinatura.
  detalhe        text,

  -- Corpo cru, truncado em 20.000 caracteres pelo receiver.
  corpo_bruto    text,

  -- TAMANHO do header `x-correios-signature`, nunca o valor. Distingue
  -- "chegou sem assinatura" (0) de "chegou com assinatura que nao confere".
  assinatura_len smallint
);

COMMENT ON TABLE public.correios_webhook_eventos IS
  'Uma linha por requisicao recebida em /api/correios/webhook, gravada antes de qualquer decisao. Observacao apenas: nada aqui e lido para decidir. Pode conter dado pessoal no corpo cru.';
COMMENT ON COLUMN public.correios_webhook_eventos.resultado IS
  'recebido (sem desfecho, processo morreu no meio) | aceito | assinatura_invalida | objeto_desconhecido | ignorado | erro.';
COMMENT ON COLUMN public.correios_webhook_eventos.corpo_bruto IS
  'Corpo como chegou, truncado em 20000 chars. Pode conter dado pessoal (ex.: recebedor em eventos BDE).';
COMMENT ON COLUMN public.correios_webhook_eventos.assinatura_len IS
  'Tamanho do header x-correios-signature. O valor da assinatura nunca e gravado.';

-- ---------------------------------------------------------------------------
-- 2. INDICES
--    Os tres acessos previstos: "o que chegou agora", "o que chegou deste
--    objeto" e "o que chegou deste pedido".
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS correios_webhook_eventos_recebido_em_idx
  ON public.correios_webhook_eventos (recebido_em DESC);

CREATE INDEX IF NOT EXISTS correios_webhook_eventos_objeto_idx
  ON public.correios_webhook_eventos (objeto)
  WHERE objeto IS NOT NULL;

CREATE INDEX IF NOT EXISTS correios_webhook_eventos_id_int_idx
  ON public.correios_webhook_eventos (id_int)
  WHERE id_int IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RLS E ACL
--
--    RLS ligada e ZERO policies: `service_role` ignora RLS (e e a unica
--    identidade que escreve aqui), e qualquer outra role passa a enxergar
--    conjunto vazio.
--
--    RLS sozinha NAO basta, e este e o ponto que ja escapou antes neste projeto:
--    o Supabase concede privilegios a `anon` e `authenticated` por DEFAULT
--    PRIVILEGE no schema public, e `REVOKE ... FROM PUBLIC` nao alcanca grant
--    explicito de role. Sem os REVOKEs abaixo, `anon` continuaria com GRANT na
--    tabela — barrado pela RLS hoje, e desprotegido no dia em que alguem criar
--    uma policy permissiva sem lembrar deste detalhe.
--
--    A SEQUENCE do bigserial tem ACL PROPRIA e entra no mesmo tratamento.
-- ---------------------------------------------------------------------------

ALTER TABLE public.correios_webhook_eventos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.correios_webhook_eventos FROM PUBLIC;
REVOKE ALL ON TABLE public.correios_webhook_eventos FROM anon;
REVOKE ALL ON TABLE public.correios_webhook_eventos FROM authenticated;
GRANT  ALL ON TABLE public.correios_webhook_eventos TO service_role;

REVOKE ALL ON SEQUENCE public.correios_webhook_eventos_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.correios_webhook_eventos_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.correios_webhook_eventos_id_seq FROM authenticated;
GRANT  ALL ON SEQUENCE public.correios_webhook_eventos_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- 4. VERIFICACOES (rodar DEPOIS de aplicar)
--
-- a) A tabela existe com as colunas esperadas:
--      SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'correios_webhook_eventos'
--       ORDER BY ordinal_position;
--    Esperado: 9 colunas; `recebido_em` com default now(); `resultado` com
--    default 'recebido' e NOT NULL.
--
-- b) RLS ligada e SEM policy:
--      SELECT c.relrowsecurity,
--             (SELECT count(*) FROM pg_policies p
--               WHERE p.schemaname = 'public'
--                 AND p.tablename = 'correios_webhook_eventos') AS policies
--        FROM pg_class c
--        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
--       WHERE c.relname = 'correios_webhook_eventos';
--    Esperado: relrowsecurity = true, policies = 0.
--
-- c) ACL COMPLETO da TABELA — array_agg inteiro, nao so procurar por
--    'service_role'. E aqui que `anon` aparece quando o REVOKE falta:
--      SELECT array_agg(DISTINCT grantee ORDER BY grantee) AS com_privilegio
--        FROM information_schema.role_table_grants
--       WHERE table_schema = 'public' AND table_name = 'correios_webhook_eventos';
--    Esperado: {postgres,service_role}. Se `anon` ou `authenticated`
--    aparecerem, o REVOKE da secao 3 nao pegou — investigue antes de seguir.
--
-- d) ACL COMPLETO da SEQUENCE (ACL separada da tabela):
--      SELECT array_agg(DISTINCT grantee ORDER BY grantee) AS com_privilegio
--        FROM information_schema.role_usage_grants
--       WHERE object_schema = 'public'
--         AND object_name = 'correios_webhook_eventos_id_seq';
--    Esperado: {postgres,service_role} (ou vazio, se nenhum USAGE explicito
--    sobreviver ao REVOKE). `anon` presente = problema.
--
-- e) Comparacao com o vizinho de mesmo padrao, para ver a diferenca de
--    proposito (aquele mantem os grants default e depende so da RLS):
--      SELECT table_name, array_agg(DISTINCT grantee ORDER BY grantee)
--        FROM information_schema.role_table_grants
--       WHERE table_schema = 'public'
--         AND table_name IN ('correios_webhook_eventos', 'producao_acesso_eventos')
--       GROUP BY table_name;
--    Esperado: a nova SEM anon/authenticated; a antiga COM (estado atual dela).
--
-- f) Os tres indices existem:
--      SELECT indexname FROM pg_indexes
--       WHERE schemaname = 'public' AND tablename = 'correios_webhook_eventos'
--       ORDER BY indexname;
--    Esperado: o PK mais recebido_em_idx, objeto_idx, id_int_idx.
--
-- g) O CHECK aceita os seis valores e recusa qualquer outro:
--      SELECT pg_get_constraintdef(oid)
--        FROM pg_constraint
--       WHERE conname = 'correios_webhook_eventos_resultado_check';
--
-- h) Depois do primeiro evento real, e o que responde a pergunta que originou
--    tudo isto:
--      SELECT resultado, count(*), max(recebido_em)
--        FROM public.correios_webhook_eventos
--       GROUP BY resultado ORDER BY 2 DESC;
--    Zero linhas = os Correios nao chamaram. Linhas com
--    'assinatura_invalida' = chamaram e o segredo diverge.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
--   DROP TABLE public.correios_webhook_eventos;
--
--   (a sequence do bigserial e os indices caem junto)
--
--   Seguro a qualquer momento: nada le esta tabela para decidir, e nenhuma
--   outra estrutura depende dela. O custo do rollback e perder o historico de
--   requisicoes — ou seja, voltar exatamente ao estado que motivou a migration.
--
--   NOTA DE RETENCAO (decisao do dono, NAO incluida aqui de proposito):
--   por conter possivel dado pessoal, convem expurgo periodico, por exemplo
--     DELETE FROM public.correios_webhook_eventos
--      WHERE recebido_em < now() - interval '180 days';
--   Nao criei job nem funcao para isso nesta migration: o prazo e uma decisao
--   de negocio, e uma funcao nova traria ACL propria para revisar junto.
-- ---------------------------------------------------------------------------
