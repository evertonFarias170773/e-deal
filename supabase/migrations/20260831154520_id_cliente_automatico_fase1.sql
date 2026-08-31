-- =====================================================================
-- id_cliente automatico — FASE 1: a sequence e a funcao geradora
-- =====================================================================
--
-- O QUE
-- -----
-- Cria os dois objetos que vao gerar `public.clientes.id_cliente`
-- automaticamente a partir de 70.000:
--
--   * public.seq_id_cliente_vibe    — sequence integer, comeca em 70000;
--   * public.fn_proximo_id_cliente()— devolve o proximo numero LIVRE,
--                                     pulando os ja ocupados.
--
-- Esta migration e INERTE. Nada passa a usar esses objetos aqui: a coluna
-- `clientes.id_cliente` continua SEM default (isso e a Fase 2) e o codigo da
-- aplicacao continua enviando o numero explicitamente. Em Postgres, valor
-- explicito no INSERT sempre vence o DEFAULT — entao mesmo depois da Fase 2 o
-- comportamento so muda quando o codigo passar a OMITIR a coluna.
--
-- POR QUE ISSO EXISTE
-- -------------------
-- Ate hoje todo cliente novo nasce no sistema antigo da Ideal e o atendente
-- repete o `id_cliente` a mao no Vibe. O campo e obrigatorio, digitado livre,
-- sem sugestao e sem geracao automatica — o unico ponto de escrita do sistema
-- inteiro e `createCadastro` em src/features/cadastros/services/cadastros.service.ts.
--
-- O custo disso ja apareceu: o cadastro MN LASER nasceu em 28/08/2026 com
-- id_cliente = 123133 por erro de digitacao (o certo era 133), e desfazer exigiu
-- a migration 20260831152142_corrige_id_cliente_mn_laser.sql — 12 linhas filhas
-- em 6 tabelas, com FK tornada adiavel dentro da transacao.
--
-- POR QUE SEQUENCE + LACO, E NAO max(id_cliente)+1
-- ------------------------------------------------
-- `nextval()` e atomico e NAO transacional: dois atendentes salvando ao mesmo
-- tempo nunca recebem o mesmo numero, mesmo antes do commit. Qualquer solucao em
-- aplicacao (max+1, sugestao na tela) reproduz o TOCTOU que ja existe hoje — a
-- checagem de duplicidade atual e um SELECT antes do INSERT, e so o indice UNIQUE
-- clientes_id_cliente_key barra de verdade.
--
-- O LACO que pula ocupados e o que dispensa reposicionar a sequence para sempre:
-- se alguem cadastrar 70050 no modo manual, a sequence segue onde esta e
-- simplesmente PULA o 70050 quando chegar la. Nada de setval de manutencao.
--
-- O CENARIO REAL (levantamento de 31/08/2026, somente leitura)
-- ------------------------------------------------------------
-- * 65.963 cadastros no total; 65.915 abaixo de 70.000; apenas 44 acima;
-- * 4 linhas com id_cliente NULL (nenhuma e cadastro real: 2 vazias e 2 de teste);
-- * zero linha com id_cliente igual a 0 ou negativo;
-- * o 70000 esta OCUPADO (Lisiane Colbeich Goulart, 18/12/2025) — por isso o
--   primeiro numero entregue por esta funcao e 70001, nao 70000;
-- * ha 10.000 numeros seguidos livres entre 70001 e 80000. A ~150 cadastros por
--   mes, o gerador leva mais de 5 anos para topar no primeiro ocupado (80001);
-- * 9 FKs apontam para clientes.id_cliente — e chave de negocio, nunca deve ser
--   trocada depois de criada (o codigo ja garante: CadastroUpdatePayload faz
--   Omit<CadastroInsertPayload, "id_cliente">).
--
-- A SEQUENCE ORFA QUE NAO DEVE SER REAPROVEITADA
-- ----------------------------------------------
-- Existe em producao uma sequence `public.clientes_id_cliente_seq`, resto de
-- quando a coluna foi `serial` na importacao do sistema antigo. Ela esta:
--
--   * ORFA   — pg_depend nao a liga a nenhuma tabela/coluna;
--   * PARADA em last_value = 959595, is_called = true;
--   * SEM USO — nada no banco nem no codigo a referencia.
--
-- Reaproveita-la significaria herdar o 959595: o proximo nextval devolveria
-- 959596, muito acima da faixa pretendida. Por isso esta migration cria uma
-- sequence NOVA, com nome explicito, e NAO TOCA na orfa. A orfa fica registrada
-- aqui como achado — remove-la e decisao separada, fora do escopo desta fase.
--
-- (Nota de correcao: o cabecalho de 20260831152142 afirma "sem sequence. Nao ha
-- sequence para acertar depois". Ha uma, mas esta desligada da coluna — o efeito
-- pratico descrito la continua correto.)
--
-- PERMISSOES
-- ----------
-- O app usa createBrowserClient (@supabase/ssr) com a sessao do usuario, ou seja
-- role `authenticated`. A funcao e SECURITY DEFINER para enxergar a tabela inteira
-- independentemente de RLS, com search_path fixo.
--
-- O REVOKE precisa citar `anon` EXPLICITAMENTE: no Supabase o schema public tem
-- default privileges que concedem EXECUTE a anon e authenticated no momento do
-- CREATE FUNCTION, e `REVOKE ... FROM PUBLIC` nao alcanca um grant nominal.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ----------------------------
-- * nao aplica DEFAULT em clientes.id_cliente (Fase 2);
-- * nao toca em clientes_id_cliente_seq;
-- * nao insere, atualiza nem apaga nenhuma linha;
-- * nao mexe nas 9 FKs, nos 3 triggers, nas policies nem nos grants de `clientes`;
-- * nao altera codigo da aplicacao.
--
-- PRECEDENTE NO REPO
-- ------------------
-- Mesmo formato de 20260829_seq_nfe_avulsa_id_int.sql: sequence dedicada +
-- funcao `fn_proximo_*`, com grant para authenticated/service_role e revoke do anon.
-- =====================================================================

create sequence if not exists public.seq_id_cliente_vibe
  as integer
  start with 70000
  minvalue 70000
  no cycle;

comment on sequence public.seq_id_cliente_vibe is
  'Numeracao propria do Vibe para clientes.id_cliente, a partir de 70.000. Consumida apenas por public.fn_proximo_id_cliente(), que pula os valores ja ocupados. NAO confundir com a sequence orfa clientes_id_cliente_seq (parada em 959595, sem dono, sem uso).';

create or replace function public.fn_proximo_id_cliente()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidato  integer;
  v_tentativas integer := 0;
begin
  -- nextval e atomico e nao transacional: dois chamadores simultaneos nunca
  -- recebem o mesmo numero. O laco cobre apenas os valores JA ocupados por
  -- cadastros historicos criados fora de ordem (44 linhas acima de 70.000).
  loop
    v_candidato := nextval('public.seq_id_cliente_vibe')::integer;

    exit when not exists (
      select 1 from public.clientes where id_cliente = v_candidato
    );

    v_tentativas := v_tentativas + 1;
    if v_tentativas > 10000 then
      raise exception
        'fn_proximo_id_cliente: 10000 tentativas sem numero livre a partir de %. A faixa esta saturada — revisar a numeracao antes de continuar.',
        v_candidato;
    end if;
  end loop;

  return v_candidato;
end;
$$;

comment on function public.fn_proximo_id_cliente() is
  'Devolve o proximo clientes.id_cliente livre a partir de 70.000, pulando os ocupados. Atomica sob concorrencia (nextval). Nao precisa ser reposicionada quando alguem cadastra manualmente acima do proximo automatico: o laco pula o valor na hora do uso.';

revoke all on function public.fn_proximo_id_cliente() from public;
revoke all on function public.fn_proximo_id_cliente() from anon;
grant execute on function public.fn_proximo_id_cliente() to authenticated, service_role;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT)
-- =====================================================================
--
-- (a) ACL da funcao — anon NAO pode aparecer. aclexplode() e set-returning, entao
--     precisa vir de um LATERAL: chamada dentro de array_agg da erro 0A000.
--     select p.proname, p.prosecdef as security_definer, p.proconfig as config,
--            array_agg(acl.grantee::regrole::text order by acl.grantee::regrole::text) as grantees
--       from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--       cross join lateral aclexplode(p.proacl) as acl
--      where n.nspname = 'public' and p.proname = 'fn_proximo_id_cliente'
--      group by p.proname, p.prosecdef, p.proconfig;
--     -- esperado: {authenticated, postgres, service_role}. SEM anon, SEM public ("-").
--
--     Conferencia direta do que importa:
--     select has_function_privilege('anon','public.fn_proximo_id_cliente()','EXECUTE') as anon_execute,
--            has_function_privilege('authenticated','public.fn_proximo_id_cliente()','EXECUTE') as auth_execute,
--            has_function_privilege('service_role','public.fn_proximo_id_cliente()','EXECUTE') as service_execute;
--     -- esperado: false | true | true
--
-- (b) a coluna continua SEM default (a Fase 2 nao foi aplicada):
--     select column_default from information_schema.columns
--      where table_schema='public' and table_name='clientes' and column_name='id_cliente';
--     -- esperado: null
--
-- (c) a funcao entrega 70001 e depois 70002 (o 70000 esta ocupado e e pulado):
--     select public.fn_proximo_id_cliente();  -- 70001
--     select public.fn_proximo_id_cliente();  -- 70002
--
-- (d) devolver a sequence apos o teste (nada foi inserido, entao os numeros
--     consumidos podem voltar):
--     select setval('public.seq_id_cliente_vibe', 70000, true);
--     select last_value, is_called from public.seq_id_cliente_vibe;
--     -- esperado: 70000 | true  (o proximo nextval volta a ser 70001)
--
-- (e) nenhuma linha foi criada durante o teste:
--     select count(*) from public.clientes where id_cliente >= 70000;
--     -- esperado: 44
--
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Enquanto a Fase 2 nao existir, nada depende destes objetos: derruba-los nao
-- afeta nenhuma linha, nenhuma FK e nenhum fluxo. Se a Fase 2 ja estiver
-- aplicada, remover o DEFAULT ANTES:
--
--   -- alter table public.clientes alter column id_cliente drop default;
--
--   -- drop function if exists public.fn_proximo_id_cliente();
--   -- drop sequence if exists public.seq_id_cliente_vibe;
-- =====================================================================
