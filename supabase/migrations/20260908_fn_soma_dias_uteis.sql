-- Soma de dias uteis: public.soma_dias_uteis(date, integer) -> date
--
-- O QUE E
--   Uma funcao, e mais nada:
--
--     public.soma_dias_uteis(data_base date, dias integer) returns date
--       STABLE, SECURITY INVOKER, search_path fixado
--
--   Avanca a partir de `data_base + 1`, dia a dia, contando so o que nao for
--   sabado, domingo nem feriado NACIONAL de public.feriados, ate acumular
--   `dias` uteis. Devolve a data do ultimo dia util contado.
--
--   A DATA BASE NAO CONTA. `soma_dias_uteis('2026-09-04', 1)` responde
--   '2026-09-08', nao '2026-09-04': o primeiro dia util e sempre depois da base.
--
-- POR QUE
--   `somarDiasDeProducao` (src/features/pedidos/prazo-producao.ts:56) faz esta
--   conta hoje em JavaScript e so pula sabado e domingo — o comentario dela diz
--   "feriados nao entram". Um prazo de 3 dias uteis que atravessa o Carnaval
--   vence dois dias antes do que a fabrica consegue entregar.
--
--   `public.feriados` foi criada em 08/09/2026 justamente para isso, e esta e a
--   funcao que a le. As duas juntas fecham a conta no banco.
--
-- ============================================================================
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
-- ============================================================================
--   Nao altera prazo-producao.ts nem nenhum arquivo do aplicativo. NADA chama
--   esta funcao ainda: ela nasce inerte, como feriados nasceu.
--   Nao emite GRANT nem REVOKE — ver a secao de ACL, que e para LER antes de
--   aplicar, nao para executar.
--   Nao cria trigger, view nem RPC alem desta funcao.
--   Nao altera public.feriados, produtos, propostas, propostas_os,
--   propostas_os_setores nem categoria_frete.
--   Nao trata feriado ESTADUAL nem MUNICIPAL: filtra abrangencia = 'NACIONAL'.
--   As colunas uf/municipio de feriados existem, estao vazias, e o dia em que
--   forem preenchidas esta funcao precisa de outra conversa — nao de um filtro
--   a mais escrito por conta propria.
--
-- ============================================================================
-- A REGRA DE ZERO — por que 0 vira NULL, e nao "mesmo dia"
-- ============================================================================
--   `dias = 0` devolve NULL, junto com nulo e negativo.
--
--   Zero PARECE significar "entrega hoje", mas nao e isso que ele quer dizer
--   aqui. A tela de cadastro de produto tem `min="1"` no campo e NENHUMA
--   validacao de formulario (verificado em 08/09/2026), entao um 0 digitado a
--   mao e gravado. Esse 0 e ausencia de prazo mal preenchida, nao promessa de
--   entrega no mesmo dia — e prometer o mesmo dia por causa dele seria o pior
--   desfecho possivel.
--
--   Negativo idem: nao ha leitura util de "menos tres dias uteis".
--
-- ============================================================================
-- RLS E SECURITY INVOKER — medido, nao deduzido
-- ============================================================================
--   `public.feriados` tem RLS ligado e UMA politica: SELECT para authenticated.
--   Com SECURITY INVOKER a funcao le com as permissoes de quem chama. Testado no
--   banco em 08/09/2026, com `set local role` dentro de transacao revertida:
--
--     authenticated -> 26 linhas. A funcao enxerga o calendario inteiro.
--     anon          -> ERRO 42501, "permission denied for table feriados".
--
--   O erro do `anon` e a NOTICIA BOA, e vale entender por que:
--
--   `anon` nao tem nem GRANT de SELECT na tabela — ela foi criada por `postgres`,
--   e o default privilege de `postgres` no schema public nao inclui `anon`. A
--   permissao falta ANTES do RLS, entao a chamada aborta com erro em vez de
--   devolver zero linhas.
--
--   ISSO IMPORTA porque zero linhas seria pior que erro: a funcao contaria como
--   se nao houvesse feriado nenhum e devolveria uma data mais cedo, sem avisar.
--   Prazo errado que parece certo. Do jeito que esta, quem nao pode ler o
--   calendario recebe um erro e ninguem promete nada.
--
--   NAO E PRECISO SECURITY DEFINER. A funcao funciona como INVOKER para quem
--   deve chama-la.
--
--   !! ARMADILHA FUTURA: se alguem um dia rodar
--        grant select on public.feriados to anon;
--      sem criar politica para `anon`, o erro 42501 some e o RLS passa a
--      responder ZERO LINHAS em silencio — trocando a falha ruidosa pela falha
--      muda. Se `anon` precisar ler o calendario, o caminho e uma POLITICA, nao
--      um GRANT solto.
--
-- ============================================================================
-- ACL DA FUNCAO — para LER antes de aplicar. Nenhum comando aqui e executado.
-- ============================================================================
--   Esta migration NAO emite GRANT nem REVOKE, por instrucao. O que segue e o
--   ACL PREVISTO, deduzido do que as funcoes vizinhas de `public` ja tem
--   (medido em 08/09/2026):
--
--     duplicar_produto     -> PUBLIC, anon, authenticated, postgres, service_role
--     match_documents      -> PUBLIC, anon, authenticated, postgres, service_role
--     link_cliente_pedido  ->         anon, authenticated, postgres, service_role
--
--   Ou seja: funcao nova em `public` nasce executavel por todo mundo, incluindo
--   `anon` e PUBLIC. Duas fontes se somam — o default do proprio Postgres, que
--   concede EXECUTE a PUBLIC em toda funcao nova, e o `pg_default_acl` do
--   Supabase, que concede a anon/authenticated/service_role.
--
--   E POR ISSO QUE `REVOKE ... FROM PUBLIC` NAO BASTA: tirar de PUBLIC deixa o
--   grant EXPLICITO a `anon` de pe. Fechar de verdade exigiria os dois:
--
--     revoke execute on function public.soma_dias_uteis(date, integer) from public;
--     revoke execute on function public.soma_dias_uteis(date, integer) from anon;
--
--   NENHUM DOS DOIS FOI EXECUTADO, e a decisao e do dono. O contexto para
--   decidir: hoje `anon` que chamar a funcao ja recebe erro 42501 ao tocar em
--   `feriados`, entao o EXECUTE aberto nao vaza calendario nem prazo. O que ele
--   permite e gastar CPU do banco — a funcao e um laco.
--
-- ============================================================================
-- O CALENDARIO TERMINA EM 2027 — e a funcao nao avisa em runtime
-- ============================================================================
--   `public.feriados` cobre 2026 e 2027, e mais nada. Uma conta que caia em 2028
--   ou depois nao encontra feriado nenhum naquele periodo, conta esses dias como
--   uteis e devolve uma data CEDO DEMAIS.
--
--   A funcao NAO falha por isso, de proposito: derrubar o boletim porque o
--   calendario acabou seria trocar um prazo errado por uma tela quebrada. O
--   aviso vive no comentario da funcao e na assercao (6) desta migration, que
--   mede a fronteira no momento da aplicacao.
--
--   Quem estender o calendario deve rodar de novo a assercao (6) para conferir
--   ate onde a conta e confiavel.
--
-- ============================================================================
-- MEDIDO NO BANCO EM 08/09/2026, ANTES DE ESCREVER
-- ============================================================================
--   Funcao de dia util / soma_dias / business_day / workday ....... 0
--     -> nao ha duplicata a criar.
--   public.feriados ............................................... 26 linhas
--     -> 13 em 2026, 13 em 2027, todas NACIONAL, uf e municipio nulos.
--
--   As contas de referencia, conferidas dia a dia contra as linhas reais:
--
--     2026-09-04 (sexta) + 1 -> 05 e 06 fds, 07 Independencia -> 2026-09-08
--     2027-03-25 (quinta) + 2 -> 26 Paixao, 27 e 28 fds, 29 = 1, 30 = 2
--                             -> 2027-03-30
--
--   A terceira conta de referencia esta PENDENTE DE DECISAO — ver a assercao
--   (5c) comentada la embaixo, e o motivo logo abaixo dela.
-- ============================================================================

do $migration$
declare
  v_existe      bigint;
  v_a           date;
  v_b           date;
  v_zero        date;
  v_nulo_dias   date;
  v_nulo_base   date;
  v_fronteira   date;
  v_secdef      boolean;
  v_volatil     char;
begin
  -- ==========================================================================
  -- ASSERCOES DE ENTRADA
  -- ==========================================================================

  -- 1. A funcao ainda nao existe, com esta assinatura.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'soma_dias_uteis'
       and pg_get_function_identity_arguments(p.oid) = 'data_base date, dias integer'
  ) then
    raise exception 'ENTRADA: public.soma_dias_uteis(date, integer) JA existe — confira antes';
  end if;

  -- 2. Nem sob outro nome. Uma segunda funcao de dia util e uma segunda regra de
  --    prazo, e elas divergem no dia em que alguem corrigir so uma.
  select count(*) into v_existe
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog','information_schema')
     and (p.proname ilike '%dia_util%' or p.proname ilike '%dias_uteis%'
          or p.proname ilike '%business_day%' or p.proname ilike '%workday%');
  if v_existe <> 0 then
    raise exception 'ENTRADA: ja existe % funcao(oes) de dia util no banco — nao crie duplicata', v_existe;
  end if;

  -- 3. A tabela que a funcao le existe e tem conteudo. Sem isto a funcao nasce
  --    contando so fim de semana, que e exatamente o defeito que ela conserta.
  if to_regclass('public.feriados') is null then
    raise exception 'ENTRADA: public.feriados nao existe — esta funcao le dela';
  end if;

  select count(*) into v_existe from public.feriados where abrangencia = 'NACIONAL';
  if v_existe = 0 then
    raise exception 'ENTRADA: public.feriados nao tem nenhum feriado NACIONAL';
  end if;
  raise notice 'ENTRADA: public.feriados tem % feriados NACIONAIS', v_existe;

  -- ==========================================================================
  -- A FUNCAO
  -- ==========================================================================
  create function public.soma_dias_uteis(data_base date, dias integer)
  returns date
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
  as $fn$
  declare
    v_data      date;
    v_restantes integer;
    v_voltas    integer := 0;
  begin
    -- Ausencia de prazo, em qualquer das formas. Zero entra aqui de proposito:
    -- ver "A REGRA DE ZERO" no cabecalho da migration.
    if data_base is null or dias is null or dias < 1 then
      return null;
    end if;

    v_data      := data_base;
    v_restantes := dias;

    while v_restantes > 0 loop
      v_data   := v_data + 1;
      v_voltas := v_voltas + 1;

      -- Guarda contra laco infinito. Nao ha calendario real que a alcance: sao
      -- 10 anos de dias corridos para um unico dia util pedido. Se disparar, o
      -- dado de entrada esta absurdo ou public.feriados foi populada errado, e
      -- errar alto e melhor do que segurar uma conexao para sempre.
      if v_voltas > 3650 then
        raise exception 'soma_dias_uteis: laco excedeu 3650 dias a partir de % pedindo % dias uteis', data_base, dias;
      end if;

      -- isodow: 1=segunda ... 6=sabado, 7=domingo.
      if extract(isodow from v_data) < 6
         and not exists (
           select 1 from public.feriados f
            where f.data = v_data and f.abrangencia = 'NACIONAL'
         )
      then
        v_restantes := v_restantes - 1;
      end if;
    end loop;

    return v_data;
  end;
  $fn$;

  comment on function public.soma_dias_uteis(date, integer) is
    'Soma dias UTEIS a uma data, pulando sabado, domingo e feriado NACIONAL de public.feriados. A DATA BASE NAO CONTA: a contagem comeca no dia seguinte, entao (sexta, 1) devolve a proxima segunda util. dias nulo, zero ou negativo devolve NULL — zero e ausencia de prazo, nao entrega no mesmo dia, porque a tela de produto nao valida o campo e grava 0 digitado. Feriado ESTADUAL e MUNICIPAL NAO entram nesta conta: a funcao filtra abrangencia = NACIONAL. ATENCAO: o calendario cadastrado termina em 2027-12-31; conta que atravesse essa data conta feriado A MENOS e devolve prazo CEDO DEMAIS, sem avisar em runtime.';

  -- ==========================================================================
  -- ASSERCOES DE SAIDA
  -- ==========================================================================

  -- 4. A funcao ficou com as propriedades prometidas. STABLE porque le tabela
  --    (IMMUTABLE seria mentira e o planner cacharia resultado velho);
  --    SECURITY INVOKER porque a leitura deve respeitar quem chama.
  select p.prosecdef, p.provolatile into v_secdef, v_volatil
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'soma_dias_uteis';

  if v_secdef is null then
    raise exception 'SAIDA: public.soma_dias_uteis nao foi criada';
  end if;
  if v_secdef then
    raise exception 'SAIDA: a funcao ficou SECURITY DEFINER, deveria ser INVOKER';
  end if;
  if v_volatil <> 's' then
    raise exception 'SAIDA: a funcao deveria ser STABLE (provolatile=s), esta %', v_volatil;
  end if;

  -- Checa a PRESENCA de search_path, nao o texto exato: o Postgres normaliza o
  -- valor ao gravar em proconfig, e comparar string literal faria a migration
  -- abortar por formatacao, nao por defeito.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'soma_dias_uteis'
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ) then
    raise exception 'SAIDA: a funcao ficou sem search_path fixado';
  end if;

  -- 5. As contas, contra o calendario real.

  -- (5a) sexta + 1 util: 05 e 06 sao fim de semana, 07 e a Independencia.
  v_a := public.soma_dias_uteis('2026-09-04', 1);
  if v_a is distinct from date '2026-09-08' then
    raise exception 'SAIDA (5a): soma_dias_uteis(2026-09-04, 1) deveria ser 2026-09-08, veio %', v_a;
  end if;

  -- (5b) quinta + 2 uteis: 26/03 e a Paixao, 27 e 28 sao fim de semana,
  --      29 conta 1 e 30 conta 2.
  v_b := public.soma_dias_uteis('2027-03-25', 2);
  if v_b is distinct from date '2027-03-30' then
    raise exception 'SAIDA (5b): soma_dias_uteis(2027-03-25, 2) deveria ser 2027-03-30, veio %', v_b;
  end if;

  -- ------------------------------------------------------------------------
  -- (5c) PENDENTE DE DECISAO DO DONO — NAO ATIVAR SEM CONFIRMACAO
  -- ------------------------------------------------------------------------
  -- A especificacao pediu que soma_dias_uteis('2026-12-23', 3) fosse
  -- '2026-12-30', "pulando 25/12 e fim de semana". Pela regra escrita nesta
  -- funcao o resultado e '2026-12-29'. A diferenca esta em 24/12:
  --
  --   2026-12-23  quarta  <- base, nao conta
  --   2026-12-24  QUINTA  <- dia util pela regra: nao e fim de semana e NAO esta
  --                          em public.feriados. Conta como 1.
  --   2026-12-25  sexta   <- Natal, esta na tabela. Pula.
  --   2026-12-26  sabado  <- pula
  --   2026-12-27  domingo <- pula
  --   2026-12-28  segunda <- conta 2
  --   2026-12-29  terca   <- conta 3  => RESULTADO 2026-12-29
  --   2026-12-30  quarta  <- so seria o terceiro se 24/12 nao contasse
  --
  -- Ou seja: '2026-12-30' e a resposta certa se a vespera de Natal NAO for dia
  -- util. Isso e plausivel como pratica da fabrica, mas hoje 24/12 nao esta em
  -- public.feriados e a rodada que criou a tabela proibiu ponto facultativo
  -- explicitamente. As duas coisas nao podem valer ao mesmo tempo.
  --
  -- Sao caminhos diferentes, e a escolha e do dono:
  --   (i)  a conta esperada estava errada -> ativar a assercao com 2026-12-29;
  --   (ii) 24/12 realmente nao se trabalha -> cadastrar a vespera em
  --        public.feriados (migration propria) e ativar com 2026-12-30. Isso
  --        muda o calendario, nao esta funcao.
  --
  -- Nao gravei nenhuma das duas como fato. Descomente a linha certa depois de
  -- decidir:
  --
  --   v_c := public.soma_dias_uteis('2026-12-23', 3);
  --   if v_c is distinct from date '2026-12-29' then   -- caminho (i)
  --     raise exception 'SAIDA (5c): esperado 2026-12-29, veio %', v_c;
  --   end if;
  -- ------------------------------------------------------------------------

  -- (5d) zero e ausencia de prazo, nao entrega no mesmo dia.
  v_zero := public.soma_dias_uteis('2026-09-08', 0);
  if v_zero is not null then
    raise exception 'SAIDA (5d): soma_dias_uteis(2026-09-08, 0) deveria ser NULL, veio %', v_zero;
  end if;

  -- (5e) dias nulo.
  v_nulo_dias := public.soma_dias_uteis('2026-09-08', null);
  if v_nulo_dias is not null then
    raise exception 'SAIDA (5e): soma_dias_uteis(2026-09-08, NULL) deveria ser NULL, veio %', v_nulo_dias;
  end if;

  -- (5f) data base nula.
  v_nulo_base := public.soma_dias_uteis(null, 3);
  if v_nulo_base is not null then
    raise exception 'SAIDA (5f): soma_dias_uteis(NULL, 3) deveria ser NULL, veio %', v_nulo_base;
  end if;

  -- Negativo, que a especificacao cobre em "menor que 1" mas nao exemplifica.
  if public.soma_dias_uteis('2026-09-08', -3) is not null then
    raise exception 'SAIDA: dias negativo deveria devolver NULL';
  end if;

  -- 6. FRONTEIRA DO CALENDARIO. Nao aborta: mede e avisa. Uma conta que passe de
  --    2027-12-31 esta somando dias num periodo sem feriado cadastrado, e todo
  --    feriado de la para frente sera contado como dia util.
  v_fronteira := public.soma_dias_uteis('2027-12-20', 15);
  if v_fronteira > date '2027-12-31' then
    raise notice 'AVISO FRONTEIRA: soma_dias_uteis(2027-12-20, 15) = % — passou de 2027-12-31.', v_fronteira;
    raise notice 'AVISO FRONTEIRA: public.feriados termina em 2027-12-31. Conta que atravesse essa data conta feriado A MENOS e devolve prazo CEDO DEMAIS. Estenda o calendario antes de confiar em prazo de 2028.';
  else
    raise notice 'FRONTEIRA: o caso de teste nao atravessou 2027-12-31 (deu %). Reconfira ao estender o calendario.', v_fronteira;
  end if;

  raise notice 'SAIDA OK: public.soma_dias_uteis criada, STABLE, SECURITY INVOKER, search_path fixado';
  raise notice 'SAIDA OK: 5a=% 5b=% / zero, nulos e negativo devolvem NULL', v_a, v_b;
  raise notice 'PENDENTE: a assercao 5c (2026-12-23 + 3) esta comentada aguardando decisao sobre 24/12';
end
$migration$;

-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   Enquanto nada chamar a funcao, derrubar nao perde nada: ela nao guarda
--   estado e o calendario que ela le fica intacto.
--
--   Isso deixa de valer quando prazo-producao.ts (ou qualquer outro chamador)
--   passar a depender dela. A assercao abaixo procura dependencias registradas
--   no catalogo antes de derrubar. Ela NAO alcanca chamada feita do aplicativo
--   por PostgREST/RPC, que nao deixa rastro em pg_depend — antes de derrubar,
--   confira tambem se algum codigo chama `soma_dias_uteis`.
--
--   do $rollback$
--   declare
--     v_dependentes bigint;
--   begin
--     select count(*) into v_dependentes
--       from pg_depend d
--       join pg_proc p on p.oid = d.refobjid
--       join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'soma_dias_uteis'
--        and d.deptype <> 'i';
--
--     if v_dependentes > 0 then
--       raise exception 'ROLLBACK ABORTADO: % objeto(s) dependem da funcao', v_dependentes;
--     end if;
--
--     drop function public.soma_dias_uteis(date, integer);
--
--     raise notice 'ROLLBACK OK: funcao removida, public.feriados intacta';
--   end
--   $rollback$;
-- ============================================================================
