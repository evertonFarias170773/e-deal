-- Faixa reservada de `id_int` para a NF-e avulsa: sequence descendente
--
-- POR QUE
--   `notas_fiscais.id_int` e NOT NULL e sempre foi o numero do pedido. A nota
--   avulsa nao nasce de proposta e nao tem pedido -- mas a coluna continua
--   exigindo um valor, e torna-la anulavel obrigaria a revisar seis views,
--   varias funcoes e todo o app que hoje pode contar com ela preenchida.
--
--   A saida e uma FAIXA RESERVADA. `id_int` nao tem FK -- nenhuma, em
--   notas_fiscais ou em notas_fiscais_itens --, entao aceita qualquer bigint. A
--   avulsa passa a usar NEGATIVOS.
--
--   NEGATIVO, e nao uma banda alta: `propostas.id_int` esta em 21.394 e sobe
--   todo dia, entao qualquer teto que escolhessemos seria alcancado um dia. O
--   dominio dos pedidos e {positivos} e cresce so para cima; o dos negativos
--   nunca sera visitado por ele. E, de quebra, e obvio na tela que -37 nao e
--   pedido.
--
-- POR QUE SEQUENCE, E NAO min(id_int) - 1
--   Duas emissoes simultaneas leriam o mesmo minimo e gerariam o mesmo numero.
--   Nota fiscal duplicada nao se conserta editando: se as duas forem
--   autorizadas, o conserto e cancelamento na SEFAZ. `nextval` e atomico e nao
--   volta atras nem sob rollback -- gera buraco na numeracao interna, que aqui
--   nao custa nada, e nunca gera repetido, que custaria caro.
--
-- POR QUE DESCENDENTE, E NAO ASCENDENTE COM NEGACAO NA LEITURA
--   Uma sequence ascendente devolveria 1, 2, 3 -- numeros POSITIVOS, que so
--   viram negativos se quem chama lembrar de negar. Quem esquecer, ou quem
--   chamar `nextval` cru, grava uma avulsa com id_int de pedido.
--
--   Descendente com `maxvalue -1`, o proprio Postgres garante o sinal: ela NAO
--   CONSEGUE devolver positivo. A regra deixa de ser convencao de quem chama e
--   passa a ser propriedade do objeto. O valor entra na coluna como sai da
--   sequence, sem passo intermediario onde errar.
--
-- COMO O APP OBTEM O NUMERO: RPC, E NAO DEFAULT DE COLUNA
--   `alter column id_int set default nextval(...)` seria mais curto e e
--   PERIGOSO: o default dispara em TODO insert em notas_fiscais que omita
--   `id_int`. Hoje o caminho com proposta sempre manda o numero, entao nao
--   dispararia -- mas "hoje" nao e garantia. Um bug futuro que deixasse de
--   mandar id_int transformaria, em silencio, uma nota de pedido em avulsa, com
--   a nota sumindo da Expedicao, da etiqueta e da conferencia de faturamento.
--
--   A RPC e explicita: so quem quer nota avulsa chama. Serve tanto para o app
--   inserir direto pelo PostgREST quanto para a funcao de rascunho avulso da
--   etapa 2 chamar de dentro do banco.
--
-- RISCO DE USO POR ENGANO NO CAMINHO COM PROPOSTA: QUATRO BARREIRAS
--   1. Nao ha default na coluna: a sequence nunca e consultada implicitamente.
--   2. `createOrReuseNfeDraft` sempre grava `id_int` a partir da proposta --
--      nunca omite o campo.
--   3. Mesmo chamada por engano, a sequence so devolve negativo, e negativo nao
--      casa com pedido nenhum.
--   4. A sequence NAO recebe USAGE para `authenticated` nem para `anon`. So a
--      funcao, que e SECURITY DEFINER, consegue avanca-la.
--
-- O FORMATO DE `ref` (implementado na ETAPA 2, nao aqui)
--   Pretendido: `NFE-AV-{n}-{seq}`, com `n` = valor absoluto do id_int e `seq` o
--   sufixo de tres digitos de sempre. Ex.: id_int -37 => `NFE-AV-37-001`.
--
--   NAO COLIDE com `NFE-{id_int}-{seq}`: "AV" nao e numero, e o formato tem
--   quatro segmentos contra tres. `UNIQUE (ref)` continua valendo sem esforco.
--
--   O sufixo de reemissao continua funcionando: ele e o ULTIMO segmento nos dois
--   formatos, que e como `createOrReuseNfeDraft` ja o le hoje
--   (`ref.split('-')`, ultimo elemento).
--
--   A alternativa era usar `NFE-{id_int}-{seq}` ao pe da letra, o que daria
--   `NFE--37-001`. Consistente com o gerador atual, mas com um traco duplo que
--   vira armadilha em qualquer `split('-')` futuro -- o segundo segmento sai
--   vazio. Preferimos o formato legivel.
--
--   DIVERGENCIA CONHECIDA, HOJE INERTE: `fn_clonar_rascunho_nfe` monta a ref
--   como `'NFE-' || id_int || '-' || lpad(seq,3,'0')`. Clonar uma avulsa
--   produziria `NFE--37-002`, fora do formato. Essa funcao NAO TEM NENHUM
--   CHAMADOR no app -- verificado --, entao nada acontece hoje. Se clonar avulsa
--   virar necessidade, e um ajuste de uma linha la, em etapa propria. Nao e
--   tocada aqui.
--
-- NEGATIVO QUEBRA ALGUMA EXIBICAO OU ORDENACAO?
--   Ordenacao: nao. O Historico NF-e ordena por `created_at desc`. O unico
--   `order by id_int` do dominio fiscal esta na consulta da FILA, que le
--   `propostas` -- a avulsa nao entra la.
--
--   Exibicao: sim, em dois pontos, e e cosmetico. `NotasFiscaisPage` mostra
--   `#{item.id_int}` e `Pedido #{item.id_int} - {ref}`, que exibiriam "#-37".
--   Trocar por "Avulsa" e a etapa 6 do plano. Nao e feito aqui, e nao impede
--   nada: nenhuma decisao do sistema depende desse texto.
--
--   Parsing: o unico ponto do app que interpreta `ref` e
--   `nfe.service.ts:779`, dentro de `createOrReuseNfeDraft` -- e ele so roda no
--   caminho com proposta, filtrando por um `id_int` positivo. Nunca ve ref de
--   avulsa. Nenhum outro lugar do app faz parsing de `ref` nem de `id_int`.
--
-- ACL DA FUNCAO NOVA -- E POR QUE ELA DIVERGE DO PADRAO DA CASA
--   Alvo: EXECUTE para `authenticated` e `service_role`. SEM PUBLIC, SEM `anon`.
--
--   As outras funcoes deste banco carregam `=X` (PUBLIC) mais grants nominais a
--   anon, authenticated e service_role. Esta e diferente de proposito: ela CUNHA
--   IDENTIFICADOR. Cada chamada consome um numero e nao devolve. Deixar `anon`
--   chamar seria deixar qualquer visitante nao autenticado avancar a sequence
--   indefinidamente -- inofensivo para a integridade, porque buraco na numeracao
--   nao machuca, mas e superficie sem nenhuma razao de existir: `anon` nao le
--   nem escreve `notas_fiscais`.
--
--   REVOGAR DE PUBLIC NAO BASTA, E ESTE ARQUIVO JA AFIRMOU O CONTRARIO.
--
--   A primeira versao desta migration dizia que um REVOKE FROM PUBLIC daria
--   conta "porque a funcao e nova e anon nunca recebeu grant nominal". ERRADO, e
--   comprovado na aplicacao: a funcao nasceu com
--   `{postgres=X, anon=X, authenticated=X, service_role=X}` mesmo depois do
--   REVOKE FROM PUBLIC, e a sequence nasceu com USAGE, SELECT e UPDATE para
--   anon, authenticated e service_role.
--
--   A RAZAO REAL: este schema tem ALTER DEFAULT PRIVILEGES, de DOIS concedentes
--   -- `postgres` e `supabase_admin` --, concedendo em TODA funcao nova
--   (`anon=X, authenticated=X, service_role=X`) e em TODA sequence nova
--   (`anon=rwU, authenticated=rwU, service_role=rwU`). O grant nasce NOMINAL, no
--   instante do CREATE. PUBLIC nunca esteve envolvido, entao revogar de PUBLIC
--   nao remove nada disso.
--
--   Conferir com:
--     select pg_get_userbyid(defaclrole), defaclobjtype, defaclacl::text
--       from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
--      where nspname = 'public';
--
--   Por isso os REVOKE nominais do passo 3. E por isso a inspecao correta e
--   `aclexplode`, nunca o texto bruto do ACL: no bruto, `anon=X/postgres` passa
--   despercebido no meio da linha.
--
--   SECURITY DEFINER e necessario: sem ele, `authenticated` precisaria de USAGE
--   na sequence, e ai poderia chamar `nextval` direto, contornando a funcao e a
--   validacao de sinal. Com DEFINER, a sequence fica privada ao dono.
--
-- NAO FAZ
--   Nao cria a funcao de rascunho avulso -- e a etapa 2. Nao monta `ref`. Nao
--   toca `notas_fiscais`, `notas_fiscais_itens`, `createOrReuseNfeDraft`,
--   `fn_criar_rascunho_nfe`, `fn_clonar_rascunho_nfe`, `fn_montar_payload_nfe`,
--   `fn_preparar_envio_nfe`, as duas triggers ajustadas, o catalogo, a Fila de
--   Faturamento nem `nota-do-pedido.ts`. Nao altera o CHECK de `origem_item`.
--   Nao torna `id_int` anulavel. Nao faz backfill. Nao mexe em RLS nem em
--   policy. Nao altera codigo da aplicacao.
--
-- ROLLBACK: ver rodape.

begin;

-- ---------------------------------------------------------------------------
-- 1. A sequence
--
--    DESCENDENTE e com teto em -1: nao existe chamada que a faca devolver zero
--    ou positivo. `no cycle` para que o esgotamento vire ERRO, e nao volta ao
--    inicio -- reiniciar repetiria numeros ja usados, que e o unico desfecho
--    inaceitavel. O piso e o minimo do bigint: 9,2 quintilhoes de notas avulsas
--    antes de acabar.
--
--    `owned by none` (o padrao) de proposito: a sequence NAO pertence a
--    `notas_fiscais.id_int`. Se pertencesse, um `drop column` futuro a levaria
--    junto, e a numeracao das avulsas ja emitidas perderia a origem.
-- ---------------------------------------------------------------------------
create sequence if not exists public.seq_nfe_avulsa_id_int
  as bigint
  increment by -1
  start with -1
  maxvalue -1
  no minvalue
  no cycle;

comment on sequence public.seq_nfe_avulsa_id_int is
  'Numeracao interna da NF-e AVULSA, a que nao nasce de proposta. Descendente com teto -1: so devolve negativo, e negativo nunca colide com propostas.id_int, que so cresce para cima. Nao e o numero da nota -- esse vem da SEFAZ. Consuma apenas por fn_proximo_id_int_nfe_avulsa(): a sequence nao tem USAGE para as roles do app.';

-- ---------------------------------------------------------------------------
-- 2. A funcao que entrega o proximo numero
-- ---------------------------------------------------------------------------
create or replace function public.fn_proximo_id_int_nfe_avulsa()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id_int bigint;
begin
  v_id_int := nextval('public.seq_nfe_avulsa_id_int');

  -- Cinto e suspensorio. A sequence e descendente com maxvalue -1, entao ela
  -- NAO CONSEGUE devolver positivo -- a menos que alguem a altere um dia. Se
  -- isso acontecer, o erro estoura AQUI, antes de existir uma nota avulsa com
  -- id_int de pedido, que sumiria da Expedicao e da etiqueta sem avisar.
  if v_id_int >= 0 then
    raise exception
      'seq_nfe_avulsa_id_int devolveu %: id_int de nota avulsa tem de ser negativo', v_id_int
      using errcode = 'data_exception';
  end if;

  return v_id_int;
end;
$function$;

comment on function public.fn_proximo_id_int_nfe_avulsa() is
  'Proximo id_int para NF-e avulsa. Sempre negativo. Atomico: nextval nao repete nem sob concorrencia ou rollback. NAO existe como default de coluna de proposito -- default dispararia em qualquer insert que omitisse id_int e transformaria nota de pedido em avulsa em silencio.';

-- ---------------------------------------------------------------------------
-- 3. ACL: so quem esta autenticado cunha numero, e so pela funcao
--
--    Sao DOIS problemas distintos, e cada um exige o seu REVOKE:
--
--    (a) PUBLIC -- `CREATE FUNCTION` concede EXECUTE a PUBLIC por padrao.
--    (b) NOMINAL -- ALTER DEFAULT PRIVILEGES deste schema concede a anon,
--        authenticated e service_role no instante do CREATE, tanto na funcao
--        quanto na sequence. Ver o bloco no cabecalho.
--
--    A SEQUENCE FICA PRIVADA AO DONO. Sem isto, `authenticated` e `anon`
--    chamariam `nextval` direto e contornariam a validacao de sinal da funcao --
--    a quarta barreira do desenho deixaria de existir.
--
--    `service_role` tambem perde acesso direto a sequence: se a regra e que so a
--    funcao avanca, meia regra vira excecao que ninguem lembra depois. Ele
--    mantem EXECUTE na funcao, que e o caminho legitimo. E `SECURITY DEFINER`
--    roda como o DONO, que conserva USAGE -- entao a funcao continua
--    funcionando. Verificado.
-- ---------------------------------------------------------------------------
revoke all on function public.fn_proximo_id_int_nfe_avulsa() from public;
revoke execute on function public.fn_proximo_id_int_nfe_avulsa() from anon;
grant execute on function public.fn_proximo_id_int_nfe_avulsa() to authenticated;
grant execute on function public.fn_proximo_id_int_nfe_avulsa() to service_role;

revoke all on sequence public.seq_nfe_avulsa_id_int from anon;
revoke all on sequence public.seq_nfe_avulsa_id_int from authenticated;
revoke all on sequence public.seq_nfe_avulsa_id_int from service_role;

commit;

-- ============================================================================
-- VERIFICACOES (rodar depois de aplicar)
--
--   -- 1. A sequence so pode andar para baixo
--   select sequencename, start_value, min_value, max_value, increment_by, cycle
--     from pg_sequences
--    where schemaname = 'public' and sequencename = 'seq_nfe_avulsa_id_int';
--   -- esperado: start -1 | min = minimo do bigint | max -1 | increment -1 | cycle false
--
--   -- 2. ACL DA FUNCAO -- explodido, nao pelo texto bruto
--   select p.proacl::text as bruto,
--          (select array_agg(pg_get_userbyid(x.grantee) || ':' || x.privilege_type
--                            order by pg_get_userbyid(x.grantee))
--             from aclexplode(p.proacl) x) as detalhado,
--          p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'fn_proximo_id_int_nfe_avulsa';
--   -- esperado, detalhado: {authenticated:EXECUTE, postgres:EXECUTE,
--   --                       service_role:EXECUTE}
--   -- NAO PODE APARECER: anon, nem o grantee 0 (PUBLIC).
--   -- esperado: prosecdef = true | proconfig = {search_path=public}
--
--   -- 3. A sequence e privada ao dono -- nenhuma role do app avanca por fora
--   select c.relacl::text as bruto,
--          (select array_agg(pg_get_userbyid(x.grantee) || ':' || x.privilege_type
--                            order by pg_get_userbyid(x.grantee), x.privilege_type)
--             from aclexplode(c.relacl) x) as detalhado
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'seq_nfe_avulsa_id_int';
--   -- esperado, bruto: {postgres=rwU/postgres}
--   -- esperado, detalhado: {postgres:SELECT, postgres:UPDATE, postgres:USAGE}
--   -- NAO PODE APARECER: anon, authenticated, service_role.
--
--   -- 3b. Os default privileges que causaram tudo isto continuam la, e vao
--   --     valer para a PROXIMA funcao ou sequence criada neste schema.
--   select pg_get_userbyid(defaclrole) as concedente,
--          defaclobjtype as tipo, defaclacl::text as concede
--     from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
--    where nspname = 'public' and defaclobjtype in ('f','S');
--   -- esperado: quatro linhas (postgres e supabase_admin, x funcao e sequence),
--   -- todas concedendo a anon, authenticated e service_role. NAO mexa nelas:
--   -- mudar default privilege afeta tudo que vier depois, no schema inteiro.
--
--   -- 4. `id_int` NAO ganhou default -- a sequence nunca dispara sozinha
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'notas_fiscais'
--      and column_name = 'id_int';
--   -- esperado: id_int | NO | (nulo)
--
--   -- 5. Nenhuma nota e nenhum item foram tocados
--   select (select count(*) from public.notas_fiscais)       as notas,
--          (select count(*) from public.notas_fiscais_itens) as itens,
--          (select md5(string_agg(id::text || '|' || coalesce(cfop,'') || '|' ||
--                                 coalesce(icms_situacao_tributaria,'') || '|' ||
--                                 coalesce(pis_situacao_tributaria,'') || '|' ||
--                                 coalesce(cofins_situacao_tributaria,'') || '|' ||
--                                 coalesce(icms_origem,''), ';' order by id))
--             from public.notas_fiscais_itens) as impressao_digital;
--   -- esperado: 25 | 66 | 7c48abc4acafbf85bc305dfa52777427
--
--   -- 6. A faixa dos pedidos segue intocada e longe
--   select min(id_int) as menor_pedido, max(id_int) as maior_pedido
--     from public.propostas;
--   -- esperado: 11929 | 21394 ou mais. Nenhum negativo, hoje nem nunca.
--
--   -- 7. TESTE QUE CONSOME UM NUMERO -- JA EXECUTADO em 29/08/2026.
--   --    Devolveu -1. A sequence ficou em last_value = -1, is_called = true, e
--   --    a proxima chamada devolve -2. O -1 foi gasto na prova e nao volta:
--   --    `setval` de volta reabriria a porta para numero repetido.
--   --
--   --    Este teste tambem prova que SECURITY DEFINER alcanca a sequence DEPOIS
--   --    dos revoke -- roda como o dono, que conserva USAGE.
--   -- select public.fn_proximo_id_int_nfe_avulsa();
--   -- select last_value, is_called from public.seq_nfe_avulsa_id_int;
--   -- esperado hoje: -2  |  depois: last_value -2, is_called true
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar em transacao)
--
-- So faca isto ANTES de existir qualquer nota avulsa. Depois, derrubar a
-- sequence perde o ponto em que a numeracao parou, e a proxima recriacao
-- comecaria de -1 de novo, repetindo numeros ja gravados. Se ja houver avulsa
-- emitida, NAO derrube: ajuste com setval para antes do menor id_int negativo
-- em uso.
--
-- Conferir primeiro:
--   select count(*) as avulsas, min(id_int) as menor
--     from public.notas_fiscais where id_int < 0;
--   -- se avulsas > 0, PARE e nao execute o rollback abaixo.
--
-- begin;
--
-- drop function if exists public.fn_proximo_id_int_nfe_avulsa();
-- drop sequence if exists public.seq_nfe_avulsa_id_int;
--
-- commit;
-- ============================================================================
