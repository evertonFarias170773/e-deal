-- NF-e: a trava de duplicidade passa a olhar o payload, nao so as colunas.
--
-- POR QUE
--   Toda trava de duplicidade do sistema pergunta por `numero_nf` e
--   `chave_nfe`. E essas sao EXATAMENTE as colunas que ficam vazias quando o
--   retorno da Focus e lido errado: o desfecho vem dentro de
--   `protocolo_nota_fiscal`, ninguem desce um nivel, e a nota congela sem
--   numero e sem chave numa nota que a SEFAZ JA AUTORIZOU.
--
--   A trava fica cega justamente onde precisa enxergar. A cadeia inteira passa:
--     1. fn_preparar_envio_nfe promove a nota a PRONTA_PARA_ENVIO;
--     2. a rota testa `numero_nf || chave_nfe` — os dois nulos;
--     3. o UPDATE de reserva exige os dois nulos — condicao satisfeita;
--     4. transmite. SEGUNDA NF-e do mesmo documento.
--
--   Em producao isso e numero queimado na SEFAZ, e numero queimado nao volta.
--   O n8n ja opera com token de producao da Biro, entao o caminho esta aberto.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CORRECAO DE UM DIAGNOSTICO ANTERIOR, QUE ESTAVA ERRADO
-- ═══════════════════════════════════════════════════════════════════════════
--   Ficou registrado que "fn_preparar_envio_nfe barra status AUTORIZADA".
--   NAO BARRA. Lendo o fonte inteiro: `AUTORIZADA` so aparece nos ramos de
--   FALHA, dentro de
--     `case when status in ('AUTORIZADA','PROCESSANDO','CANCELADA','DENEGADA')
--        then status else 'PENDENTE' end`,
--   que serve para PRESERVAR o status quando a validacao reprova. No caminho
--   feliz o UPDATE final faz `status = 'PRONTA_PARA_ENVIO'` INCONDICIONALMENTE.
--
--   Ou seja: hoje uma nota AUTORIZADA que passe na validacao e REBAIXADA a
--   PRONTA_PARA_ENVIO por esta funcao. Nao havia barreira alguma a preservar —
--   havia uma barreira a CRIAR. O guarda abaixo cobre esse caso tambem, porque
--   toda nota autorizada tem payload autorizado.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- AS TRES REGRAS
-- ═══════════════════════════════════════════════════════════════════════════
--   R1  `status` = 'autorizado' no primeiro nivel;
--   R2  `chave_nfe` presente no primeiro nivel — chave so existe depois que a
--       SEFAZ autorizou, a Focus nao a inventa antes;
--   R3  `protocolo_nota_fiscal.status` = '100' E `numero_protocolo` E
--       `chave_nfe` presentes. OS TRES.
--
--   R3 exige tres porque le o SEGUNDO nivel, onde o envelope ainda diz
--   "processando_autorizacao". Ali o risco de afirmar cedo demais e real, e um
--   '100' solto nao basta: protocolo e chave so aparecem quando a SEFAZ ja
--   respondeu. Foi a instrucao explicita do dono, e esta obedecida.
--
--   TESTADO CONTRA OS 14 PAYLOADS GRAVADOS, um a um, antes de escrever:
--     10 AUTORIZADA ....... as tres regras disparam. Correto.
--      3 ERRO_AUTORIZACAO . nenhuma regra dispara. Correto — precisam continuar
--                           reenviaveis, e continuam.
--      1 RETORNO_FOCUS .... nenhuma regra dispara (a NFE-20370-002, cujo
--                           payload foi sobrescrito por um erro).
--     ZERO falsos positivos.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- O QUE ESTE GUARDA NAO ALCANCA — e precisa estar escrito
-- ═══════════════════════════════════════════════════════════════════════════
--   Nota cujo `payload_retorno` foi SOBRESCRITO por um retorno de erro. A
--   NFE-20370-002 e o caso vivo: autorizada como NF 1002 em 22/08, e em 11/09
--   uma consulta que falhou trocou o payload por `{codigo, mensagem}`. A prova
--   sumiu do banco e NENHUMA leitura do payload pode recupera-la.
--
--   Esta trava protege as notas SEGUINTES. A 20370-002 continua reenviavel, e
--   isso e decisao consciente: ela e de homologacao, e o dono determinou que
--   ficasse intocada nesta rodada.
--
-- E RECUSA, NUNCA CORRECAO
--   Nada e gravado. Nenhuma nota vira AUTORIZADA, nenhuma coluna e preenchida,
--   nenhum status muda. A funcao so devolve `ok:false` e para. Reconciliar o
--   cadastro de quem ficou para tras (a NFE-20925-001) e outro assunto, com
--   outra autorizacao.
--
-- NOTA CANCELADA TAMBEM E BARRADA, e esta certo: cancelada e nota que foi
--   autorizada e depois baixada. Reenviar a mesma `ref` duplicaria na SEFAZ.
--   Hoje nao ha nenhuma CANCELADA no banco, entao o efeito e zero.
--
-- POR QUE A FUNCAO E ALTERADA POR INSERCAO ANCORADA, E NAO TRANSCRITA
--   `fn_preparar_envio_nfe` tem 4.867 caracteres e cinco ramos de saida.
--   Transcrever isso a mao para acrescentar um bloco e risco desproporcional:
--   um `coalesce` trocado em qualquer um dos ramos muda o comportamento de
--   validacao sem que ninguem perceba. O passo 1 abaixo le
--   `pg_get_functiondef`, INSERE o bloco antes de uma ancora unica e reexecuta.
--   O resto do corpo nao e reescrito em lugar nenhum deste arquivo.
--
--   `CREATE OR REPLACE` PRESERVA O ACL. O de antes, para conferencia:
--     dono postgres, SECURITY DEFINER, search_path=public
--     {=X/postgres,postgres=X/postgres,anon=X/postgres,
--      authenticated=X/postgres,service_role=X/postgres}
--   Esse `anon` e o PUBLIC vem do ALTER DEFAULT PRIVILEGES do schema e estao em
--   TODAS as RPCs fiscais. NAO sao tocados aqui, de proposito: cada uma precisa
--   de analise de quem a chama, e revogar de raspao junto de um conserto de
--   trava e o tipo de mistura que ninguem consegue reverter depois. Fica
--   registrado como pendencia separada. O ACL sai desta migration IDENTICO.
--
-- A OUTRA METADE DESTA CORRECAO ESTA NO APP
--   src/features/fiscal/services/ja-autorizada.ts (as mesmas tres regras) e
--   src/app/api/fiscal/emitir-nfe/route.ts (o guarda na porta de transmissao).
--   Sao duas travas de proposito: a rota barra a TRANSMISSAO, e esta funcao
--   barra a PROMOCAO a PRONTA_PARA_ENVIO — uma etapa antes, e tambem para quem
--   chamar a RPC direto pelo PostgREST, sem passar pela rota.

-- ============================================================================
-- 1. INSERIR O GUARDA, POR ANCORA
-- ============================================================================

do $$
declare
  v_src     text;
  v_novo    text;
  v_ancoras int;
  c_ancora constant text := '  -- Confere se a NF-e existe na validação geral antiga.';
  c_guarda constant text :=
'  -- TRAVA DE DUPLICIDADE PELO PAYLOAD.' || E'\n' ||
'  --' || E'\n' ||
'  --   As colunas `numero_nf` e `chave_nfe` ficam VAZIAS quando o retorno da' || E'\n' ||
'  --   Focus e lido errado — o desfecho vem dentro de `protocolo_nota_fiscal`.' || E'\n' ||
'  --   Perguntar a elas deixa passar nota que a SEFAZ ja autorizou, e reenviar' || E'\n' ||
'  --   dali cria uma SEGUNDA NF-e. Aqui a pergunta e feita ao PAYLOAD.' || E'\n' ||
'  --' || E'\n' ||
'  --   R3 (segundo nivel) exige protocolo E chave alem do codigo 100: o' || E'\n' ||
'  --   envelope ainda diz "processando_autorizacao" nesse ponto, e um 100' || E'\n' ||
'  --   solto nao e prova suficiente.' || E'\n' ||
'  --' || E'\n' ||
'  --   SO RECUSA. Nao grava, nao promove a AUTORIZADA, nao corrige coluna.' || E'\n' ||
'  select * into v_ja' || E'\n' ||
'  from public.notas_fiscais' || E'\n' ||
'  where ref = p_ref;' || E'\n' ||
'' || E'\n' ||
'  if found and v_ja.payload_retorno is not null then' || E'\n' ||
'    v_chave_payload := coalesce(' || E'\n' ||
'      nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{chave_nfe}'', '''')), ''''),' || E'\n' ||
'      nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{protocolo_nota_fiscal,chave_nfe}'', '''')), '''')' || E'\n' ||
'    );' || E'\n' ||
'    v_protocolo_payload := coalesce(' || E'\n' ||
'      nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{protocolo}'', '''')), ''''),' || E'\n' ||
'      nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{protocolo_nota_fiscal,numero_protocolo}'', '''')), '''')' || E'\n' ||
'    );' || E'\n' ||
'    v_numero_payload := coalesce(' || E'\n' ||
'      nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{numero}'', '''')), ''''),' || E'\n' ||
'      nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{requisicao_nota_fiscal,numero}'', '''')), '''')' || E'\n' ||
'    );' || E'\n' ||
'' || E'\n' ||
'    -- R1: o envelope ja se declara autorizado.' || E'\n' ||
'    if lower(coalesce(v_ja.payload_retorno #>> ''{status}'', '''')) = ''autorizado'' then' || E'\n' ||
'      v_regra_ja := ''STATUS_NIVEL_1'';' || E'\n' ||
'    -- R2: chave no primeiro nivel. So existe depois da autorizacao.' || E'\n' ||
'    elsif nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{chave_nfe}'', '''')), '''') is not null then' || E'\n' ||
'      v_regra_ja := ''CHAVE_NIVEL_1'';' || E'\n' ||
'    -- R3: o desfecho escondido no segundo nivel. Exige os TRES.' || E'\n' ||
'    elsif coalesce(v_ja.payload_retorno #>> ''{protocolo_nota_fiscal,status}'', '''') = ''100''' || E'\n' ||
'      and nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{protocolo_nota_fiscal,numero_protocolo}'', '''')), '''') is not null' || E'\n' ||
'      and nullif(btrim(coalesce(v_ja.payload_retorno #>> ''{protocolo_nota_fiscal,chave_nfe}'', '''')), '''') is not null then' || E'\n' ||
'      v_regra_ja := ''PROTOCOLO_NIVEL_2'';' || E'\n' ||
'    end if;' || E'\n' ||
'' || E'\n' ||
'    if v_regra_ja is not null then' || E'\n' ||
'      return jsonb_build_object(' || E'\n' ||
'        ''ok'', false,' || E'\n' ||
'        ''ref'', p_ref,' || E'\n' ||
'        ''pode_emitir'', false,' || E'\n' ||
'        ''erro'', ''NOTA_JA_AUTORIZADA_NO_PAYLOAD'',' || E'\n' ||
'        ''mensagem'', format(' || E'\n' ||
'          ''Esta nota JÁ PARECE AUTORIZADA na SEFAZ, embora o cadastro esteja sem número e sem chave. O retorno da Focus guardado nela traz: número %s, chave %s, protocolo %s. Transmitir de novo criaria uma SEGUNDA NF-e para o mesmo documento. Confira na SEFAZ ou no painel da Focus antes de qualquer coisa; se a nota realmente existe, o caso é reconciliar o cadastro, não emitir.'',' || E'\n' ||
'          coalesce(v_numero_payload, ''(ausente)''),' || E'\n' ||
'          coalesce(v_chave_payload, ''(ausente)''),' || E'\n' ||
'          coalesce(v_protocolo_payload, ''(ausente)'')' || E'\n' ||
'        ),' || E'\n' ||
'        ''evidencia'', jsonb_build_object(' || E'\n' ||
'          ''regra'', v_regra_ja,' || E'\n' ||
'          ''numero'', v_numero_payload,' || E'\n' ||
'          ''chave'', v_chave_payload,' || E'\n' ||
'          ''protocolo'', v_protocolo_payload' || E'\n' ||
'        )' || E'\n' ||
'      );' || E'\n' ||
'    end if;' || E'\n' ||
'  end if;' || E'\n' ||
'' || E'\n';
  c_declares constant text :=
'  v_ja record;' || E'\n' ||
'  v_regra_ja text;' || E'\n' ||
'  v_chave_payload text;' || E'\n' ||
'  v_protocolo_payload text;' || E'\n' ||
'  v_numero_payload text;' || E'\n' ||
'  v_validacao record;';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_preparar_envio_nfe';

  if v_src is null then
    raise exception 'ABORTADO: fn_preparar_envio_nfe nao encontrada.';
  end if;

  if v_src ~ 'NOTA_JA_AUTORIZADA_NO_PAYLOAD' then
    raise exception 'ABORTADO: a funcao ja tem o guarda. Nada a fazer.';
  end if;

  -- A ancora tem de ser UNICA. Inserir em duas posicoes duplicaria o guarda.
  v_ancoras := (length(v_src) - length(replace(v_src, c_ancora, ''))) / length(c_ancora);
  if v_ancoras <> 1 then
    raise exception 'ABORTADO: ancora esperada 1 vez, encontrada % vez(es). O fonte mudou; reveja.', v_ancoras;
  end if;

  -- As variaveis novas entram no bloco declare, ancoradas em `v_validacao record;`,
  -- que tambem tem de ser unico.
  if (length(v_src) - length(replace(v_src, '  v_validacao record;', ''))) / length('  v_validacao record;') <> 1 then
    raise exception 'ABORTADO: declaracao de v_validacao esperada 1 vez. O fonte mudou; reveja.';
  end if;

  v_novo := replace(v_src, '  v_validacao record;', c_declares);
  v_novo := replace(v_novo, c_ancora, c_guarda || c_ancora);

  -- Os cinco ramos originais continuam no texto. Se algum sumiu, aborta.
  if v_novo !~ 'VALIDACAO_INTERNA' or v_novo !~ 'VALIDACAO_GERAL'
     or v_novo !~ 'PAYLOAD_NULL' or v_novo !~ 'REF_OBRIGATORIA'
     or v_novo !~ 'NFE_NAO_ENCONTRADA' or v_novo !~ 'PRONTA_PARA_ENVIO'
     or v_novo !~ 'fn_alertas_nfe' or v_novo !~ 'fn_montar_payload_nfe' then
    raise exception 'ABORTADO: a insercao perdeu algum ramo original da funcao.';
  end if;

  execute v_novo;
  raise notice 'fn_preparar_envio_nfe recriada com o guarda de duplicidade pelo payload.';
end $$;

-- ============================================================================
-- 2. VERIFICACAO
-- ============================================================================
--   Estatica (o texto e o ACL) e DINAMICA contra os 14 payloads reais, sem
--   escrever: a deteccao e reproduzida em SQL puro e comparada, nota a nota,
--   com o que se espera de cada uma. A funcao em si nao e chamada aqui — ela
--   ESCREVE nos ramos de falha, e nenhuma escrita e autorizada nesta migration.

do $verifica$
declare
  v_def       text;
  v_grantees  text[];
  v_barradas  int;
  v_erros     int;
  v_lista     text;
begin
  v_def := pg_get_functiondef('public.fn_preparar_envio_nfe(text)'::regprocedure);

  -- (a) o guarda entrou, e os ramos originais continuam la
  if v_def !~ 'NOTA_JA_AUTORIZADA_NO_PAYLOAD' then
    raise exception 'ASSERCAO_A_FALHOU: o guarda nao esta na funcao.';
  end if;
  if v_def !~ 'VALIDACAO_INTERNA' or v_def !~ 'VALIDACAO_GERAL'
     or v_def !~ 'PAYLOAD_NULL' or v_def !~ 'REF_OBRIGATORIA'
     or v_def !~ 'NFE_NAO_ENCONTRADA' then
    raise exception 'ASSERCAO_A_FALHOU: algum ramo original da funcao sumiu.';
  end if;
  if v_def !~ 'fn_alertas_nfe' or v_def !~ 'fn_montar_payload_nfe' then
    raise exception 'ASSERCAO_A_FALHOU: a funcao perdeu uma das chamadas internas.';
  end if;
  -- o guarda tem de vir ANTES da validacao geral, senao ele nao evita nada
  if position('NOTA_JA_AUTORIZADA_NO_PAYLOAD' in v_def) > position('fn_alertas_nfe' in v_def) then
    raise exception 'ASSERCAO_A_FALHOU: o guarda ficou DEPOIS da validacao. Tem de vir antes.';
  end if;

  -- (b) as tres regras estao escritas, e R3 exige os tres campos
  if v_def !~ 'STATUS_NIVEL_1' or v_def !~ 'CHAVE_NIVEL_1' or v_def !~ 'PROTOCOLO_NIVEL_2' then
    raise exception 'ASSERCAO_B_FALHOU: falta alguma das tres regras.';
  end if;
  if v_def !~ 'protocolo_nota_fiscal,numero_protocolo' or v_def !~ 'protocolo_nota_fiscal,chave_nfe' then
    raise exception 'ASSERCAO_B_FALHOU: R3 nao esta exigindo protocolo E chave.';
  end if;

  -- (c) o ACL saiu IDENTICO ao que entrou
  select array_agg(distinct (a).grantee::regrole::text)
  into v_grantees
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on true
  where n.nspname = 'public' and p.proname = 'fn_preparar_envio_nfe';

  if v_grantees is distinct from array['-','anon','authenticated','postgres','service_role']::text[] then
    raise exception 'ASSERCAO_C_FALHOU: o ACL mudou. Esperado o de antes, veio %', v_grantees;
  end if;

  -- (d) a DETECCAO contra os 14 payloads reais, nota a nota
  select count(*) filter (where barrada),
         count(*) filter (where barrada <> esperado),
         string_agg(ref || '=' || case when barrada then 'BARRA' else 'passa' end, ', ' order by ref)
    into v_barradas, v_erros, v_lista
  from (
    select n.ref,
           (    lower(coalesce(n.payload_retorno #>> '{status}', '')) = 'autorizado'
             or nullif(btrim(coalesce(n.payload_retorno #>> '{chave_nfe}', '')), '') is not null
             or (    coalesce(n.payload_retorno #>> '{protocolo_nota_fiscal,status}', '') = '100'
                 and nullif(btrim(coalesce(n.payload_retorno #>> '{protocolo_nota_fiscal,numero_protocolo}', '')), '') is not null
                 and nullif(btrim(coalesce(n.payload_retorno #>> '{protocolo_nota_fiscal,chave_nfe}', '')), '') is not null)
           ) as barrada,
           -- o esperado: barrar toda AUTORIZADA, liberar ERRO_AUTORIZACAO e
           -- a RETORNO_FOCUS cujo payload foi sobrescrito.
           (n.status = 'AUTORIZADA') as esperado
      from public.notas_fiscais n
     where n.payload_retorno is not null
  ) t;

  if v_erros <> 0 then
    raise exception 'ASSERCAO_D_FALHOU: % nota(s) divergiram do esperado. Detalhe: %', v_erros, v_lista;
  end if;

  raise notice 'Assercoes OK. % de 14 payloads barrados, 0 divergencias. ACL: %', v_barradas, v_grantees;
  raise notice 'Detalhe: %', v_lista;
end
$verifica$;

-- ============================================================================
-- CONFERENCIA MANUAL (somente leitura, depois de aplicar)
-- ============================================================================
--   -- 1. o ACL, que tem de estar IDENTICO ao de antes
--   select array_agg(distinct (a).grantee::regrole::text) as grantees, p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on true
--    where n.nspname = 'public' and p.proname = 'fn_preparar_envio_nfe'
--    group by p.proacl::text;
--   -- esperado: {-, anon, authenticated, postgres, service_role}
--
--   -- 2. quem a trava barraria hoje
--   select ref, status, numero_nf,
--          payload_retorno #>> '{status}' as p_status,
--          payload_retorno #>> '{protocolo_nota_fiscal,status}' as p_prot
--     from notas_fiscais
--    where payload_retorno is not null
--      and (lower(coalesce(payload_retorno #>> '{status}','')) = 'autorizado'
--           or nullif(btrim(coalesce(payload_retorno #>> '{chave_nfe}','')),'') is not null)
--    order by ref;
--   -- esperado: as 10 AUTORIZADA, inclusive a NFE-20925-001 (numero_nf nulo).
--
--   -- 3. nenhuma linha alterada por esta migration
--   select count(*) as notas, count(*) filter (where status='PRONTA_PARA_ENVIO') as prontas
--     from notas_fiscais;
--   -- MEDIDO ANTES em 11/09/2026: 29 notas, 0 em PRONTA_PARA_ENVIO.
--
--   -- 4. o fluxo normal continua: nota nova, sem payload_retorno, nao e barrada.
--   --    NAO rodar fn_preparar_envio_nfe para conferir — ela ESCREVE.
--   select ref, status from notas_fiscais
--    where payload_retorno is null and status = 'PENDENTE' limit 3;
--   -- esperado: 3 linhas. Nenhuma delas tem payload, logo nenhuma e barrada.

-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   Reverter devolve o caminho da NF-e DUPLICADA em producao. Nenhum dado se
--   perde: o guarda so recusa, nunca escreveu linha nenhuma.
--
--   Para voltar, refaca a funcao SEM o bloco — o texto anterior esta no git,
--   no commit desta migration, e tambem no proprio banco pelo caminho inverso:
--   ler pg_get_functiondef, remover do inicio de
--   `  -- TRAVA DE DUPLICIDADE PELO PAYLOAD.` ate a linha imediatamente
--   anterior a `  -- Confere se a NF-e existe na validação geral antiga.`,
--   remover as cinco variaveis novas do bloco declare, e executar.
--
--   NAO faz parte do rollback mexer no ACL, em fn_salvar_retorno_focus_nfe, em
--   fn_montar_payload_nfe ou em nota nenhuma. Nada disso foi tocado na ida.
-- ============================================================================
