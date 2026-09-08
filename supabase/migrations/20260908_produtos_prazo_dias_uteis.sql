-- Prazo de producao do produto em numero: public.produtos.prazo_dias_uteis
--
-- O QUE E
--   Uma coluna aditiva:
--
--     public.produtos.prazo_dias_uteis  integer  NULA, SEM default
--
--   Guarda o prazo de producao do produto em DIAS UTEIS, como numero. Nula
--   significa "nao ha prazo utilizavel", e e valor legitimo: ou o cadastro esta
--   vazio, ou o texto nao diz em dias uteis.
--
--   A coluna de texto public.produtos.prazo CONTINUA EXISTINDO, intacta, com
--   todos os valores. Nenhuma leitura muda de fonte nesta etapa. Quem le o texto
--   hoje continua lendo o texto depois desta migration.
--
-- POR QUE
--   `produtos.prazo` e texto livre, e a regra de negocio precisa de um NUMERO e
--   de saber se ele conta em dias uteis ou corridos. Hoje isso e extraido a cada
--   render por regex, em src/features/pedidos/prazo-producao.ts:
--
--     - o NUMERO sai de /(\d+)/            (diasDoPrazoCadastrado, :48)
--     - util-ou-corrido sai de /util|uteis/ sobre o TEXTO (:89 e :141)
--
--   Duas consequencias de guardar so texto:
--
--     1. A conta depende de o operador escrever a frase do jeito esperado. Ja ha
--        divergencia de grafia no cadastro: "1 dia util" (sem acento) convive com
--        "1 dia util" acentuado, e as duas so funcionam porque o regex normaliza
--        acento antes de testar.
--
--     2. Nao da para ordenar, filtrar nem somar prazo no banco. Toda pergunta
--        sobre prazo tem que subir para o aplicativo e passar pelo regex.
--
--   A coluna numerica move o NUMERO para o banco. Ela NAO resolve sozinha a
--   distincao util x corrido — ver ESCOPO.
--
-- ============================================================================
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
-- ============================================================================
--   Nao altera, normaliza nem apaga public.produtos.prazo. O texto fica igual, e
--   ha assercao de saida que PROVA isso por hash linha a linha.
--   Nao muda nenhuma leitura: nenhum SELECT do aplicativo pede a coluna nova.
--   Nao cria default, CHECK, FK, indice, trigger, funcao, view, RPC nem politica.
--   Nao concede nem revoga permissao, nao toca em RLS.
--   Nao toca em propostas, propostas_os, propostas_os_setores, produtos_proposta,
--   prazo_operacional nem em prazo-producao.ts.
--   Nao altera public.duplicar_produto() — ver a RESSALVA no fim do cabecalho.
--   Nao altera codigo do aplicativo: escrita e leitura da coluna nova vem em
--   rodada separada, e ate la ela e escrita so por esta migration.
--
-- POR QUE SEM CHECK E SEM NOT NULL
--   11 das 79 linhas nascem NULAS de proposito (10 sem cadastro, 1 ambigua). Um
--   NOT NULL exigiria inventar prazo para elas, que e exatamente o que esta
--   migration se recusa a fazer. Um CHECK de faixa (ex.: > 0) so teria valor
--   depois que o aplicativo passar a escrever aqui — hoje o unico escritor e
--   este arquivo, e ele escreve 1, 2 ou 3.
--
-- POR QUE A DISTINCAO UTIL x CORRIDO NAO VEM JUNTO
--   O nome da coluna ja declara a unidade: o que estiver aqui conta em DIAS
--   UTEIS. Por isso o backfill so converte texto que DIZ dias uteis, e deixa
--   nulo o que diz outra coisa. Um texto de dias corridos nao tem lugar nesta
--   coluna, e transformar 3 corridos em 3 uteis MUDARIA a promessa ao cliente:
--   com um fim de semana no meio, sao dois dias a mais.
--
--   Se um dia for preciso guardar prazo corrido, isso e outra coluna e outra
--   decisao — nao um valor disfarcado nesta.
--
-- ============================================================================
-- updated_at: POR QUE O BACKFILL AQUI E SEGURO
-- ============================================================================
--   Diferente de public.propostas, a tabela public.produtos NAO TEM COLUNA
--   updated_at. Verificado em information_schema.columns em 08/09/2026: as
--   colunas de tempo da tabela sao created_at e mais nenhuma.
--
--   E NAO ha trigger de timestamp. A unica trigger da tabela e de auditoria:
--
--     trg_audit_produtos  AFTER INSERT OR DELETE OR UPDATE
--                         -> audit.log_row_changes_v2()
--
--   Ou seja: nao existe carimbo de relogio para o backfill mover, e nenhuma
--   ordenacao de lista depende de um. O UPDATE abaixo nao pode reordenar tela
--   nenhuma por efeito colateral de timestamp.
--
--   O QUE ELE FAZ, e esta anotado de proposito: as 68 linhas do backfill VAO
--   gerar 68 registros em audit.log_row_changes_v2. E o comportamento normal da
--   tabela e nao ha como escrever sem isso. Quem for ler a auditoria do dia 08/09
--   vai encontrar essas 68 linhas e elas vieram daqui.
--
-- ============================================================================
-- MEDIDO NO BANCO EM 08/09/2026, ANTES DE ESCREVER
-- ============================================================================
--   public.produtos ..... 79 linhas
--                         prazo_dias_uteis NAO existe (0 em information_schema)
--                         unica coluna com "prazo" no nome: prazo (text, nula)
--                         SEM coluna updated_at
--
--   Distribuicao COMPLETA de produtos.prazo (6 valores distintos, 79 linhas):
--
--     "3 dias uteis" ... 51   -> converte para 3
--     "1 dia util"  .... 12   -> converte para 1     (com acento: 1 dia util)
--     NULL ............. 10   -> fica NULA
--     "2 dias uteis" ...  4   -> converte para 2
--     "1 dia util" .....  1   -> converte para 1     (sem acento, grafia solta)
--     "3 dias" .........  1   -> fica NULA, E AMBIGUA
--
--   String vazia: 0 linhas. Texto sem numero: 0 linhas.
--
--   O AMBIGUO. "3 dias" nao diz uteis nem corridos. Pelo regex vivo hoje
--   (prazo-producao.ts:89), ausencia de "util/uteis" faz a conta rodar em dias
--   CORRIDOS — entao gravar 3 nesta coluna, que e de dias UTEIS, mudaria o
--   significado. Fica NULA ate o dono decidir.
--   E o produto id_produto = 9001, "TesteBand", ativo = false.
--
--   Total que o backfill escreve: 68 linhas. Ficam nulas: 11.
--
-- ============================================================================
-- RESSALVA — public.duplicar_produto() NAO copia a coluna nova
-- ============================================================================
--   A funcao public.duplicar_produto(smallint) tem lista de colunas HARDCODED no
--   insert e no select (25 colunas, verificado no banco vivo em 08/09/2026).
--   Ela ja NAO copia setor_pcp, id_formato, id_modelo_cor, quantidade_minima_venda,
--   tipo_blocagem nem id_gabarito — o problema e anterior a esta migration.
--
--   Consequencia: produto duplicado nasce com prazo_dias_uteis NULO, mesmo que a
--   origem tenha valor. O texto `prazo` continua sendo copiado normalmente.
--
--   Esta migration NAO altera a funcao de proposito: mexer nela e decisao a
--   parte, e alterar seis colunas faltantes de carona nao cabe aqui. Fica
--   registrado para quem for decidir.
-- ============================================================================

do $migration$
declare
  v_linhas        bigint;
  v_linhas_d      bigint;
  v_hash_prazo    text;
  v_hash_prazo_d  text;
  v_tipo          text;
  v_nulavel       text;
  v_default       text;
  v_preenchidas   bigint;
  v_nulas         bigint;
  v_ambiguo       bigint;
begin
  -- ==========================================================================
  -- ASSERCOES DE ENTRADA
  -- ==========================================================================

  -- 1. A tabela existe.
  if to_regclass('public.produtos') is null then
    raise exception 'ENTRADA: public.produtos nao existe';
  end if;

  -- 2. A coluna nova ainda nao existe. Abortar e melhor que "if not exists":
  --    coluna homonima criada por outro caminho teria outro tipo ou default, e
  --    seguir em silencio deixaria o banco diferente do que este arquivo diz.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'produtos'
       and column_name = 'prazo_dias_uteis'
  ) then
    raise exception 'ENTRADA: produtos.prazo_dias_uteis JA existe — nada a fazer, confira antes';
  end if;

  -- 3. A coluna de texto existe e e text. O backfill le dela; se ela tiver sido
  --    trocada de tipo por outro caminho, este arquivo nao vale mais.
  select data_type into v_tipo
    from information_schema.columns
   where table_schema = 'public' and table_name = 'produtos' and column_name = 'prazo';

  if v_tipo is null then
    raise exception 'ENTRADA: produtos.prazo nao existe — esta migration le dela';
  end if;
  if v_tipo <> 'text' then
    raise exception 'ENTRADA: produtos.prazo deveria ser text, e %', v_tipo;
  end if;

  -- 4. A tabela nao tem updated_at. Se um dia ganhar, o backfill abaixo passa a
  --    ter efeito colateral de timestamp e esta migration precisa ser revista
  --    ANTES de rodar — nao depois.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'produtos'
       and column_name = 'updated_at'
  ) then
    raise exception 'ENTRADA: produtos ganhou coluna updated_at — o backfill a moveria. Revise antes de aplicar.';
  end if;

  -- 5. Retrato do texto de TODAS as linhas, para provar na saida que nenhuma
  --    mudou. Hash linha a linha, nao amostra.
  select count(*) into v_linhas from public.produtos;

  select md5(coalesce(string_agg(id_produto::text || '|' || coalesce(prazo, '(null)'), ',' order by id_produto), ''))
    into v_hash_prazo from public.produtos;

  raise notice 'ENTRADA produtos: % linhas, hash do texto prazo %', v_linhas, v_hash_prazo;

  -- 6. A contagem medida em 08/09/2026. Divergencia nao aborta: o catalogo e
  --    vivo. O aviso existe para quem le o log saber contra o que este arquivo
  --    foi escrito — e um produto novo com grafia nova nasce NULO, nao errado.
  if v_linhas <> 79 then
    raise notice 'AVISO: produtos tinha 79 linhas quando esta migration foi escrita, tem % agora', v_linhas;
  end if;

  -- ==========================================================================
  -- A MUDANCA — uma coluna
  -- ==========================================================================
  -- ADD COLUMN integer NULL SEM DEFAULT: so catalogo. Nao reescreve a tabela e
  -- nao dispara trigger de linha.
  alter table public.produtos add column prazo_dias_uteis integer;

  comment on column public.produtos.prazo_dias_uteis is
    'Prazo de producao do produto em DIAS UTEIS, como numero. Nula = sem prazo utilizavel (cadastro vazio, ou texto que nao diz dias uteis). NAO guarde dias corridos aqui: a unidade e parte do contrato do nome. A coluna de texto produtos.prazo continua sendo a fonte de todas as leituras do aplicativo ate segunda ordem.';

  -- ==========================================================================
  -- BACKFILL — so o que converte sem ambiguidade
  -- ==========================================================================
  -- Lista EXPLICITA dos quatro textos, em vez de regex generico. E de proposito:
  -- um regex do tipo /(\d+)/ pegaria tambem "3 dias", que e o caso ambiguo, e o
  -- gravaria como se fosse dia util. Aqui, texto que nao esta nesta lista nao
  -- vira numero — inclusive grafia nova que apareca depois desta migration.
  --
  -- btrim protege contra espaco sobrando no cadastro; a comparacao continua
  -- exata no resto.
  update public.produtos
     set prazo_dias_uteis = case btrim(prazo)
           when '1 dia útil'   then 1
           when '1 dia util'   then 1
           when '2 dias úteis' then 2
           when '3 dias úteis' then 3
         end
   where btrim(prazo) in ('1 dia útil', '1 dia util', '2 dias úteis', '3 dias úteis');

  get diagnostics v_preenchidas = row_count;
  raise notice 'BACKFILL: % linhas receberam prazo_dias_uteis', v_preenchidas;

  -- ==========================================================================
  -- ASSERCOES DE SAIDA
  -- ==========================================================================

  -- 7. A coluna existe, com o tipo e a nulabilidade prometidos, e SEM default.
  select data_type, is_nullable, column_default
    into v_tipo, v_nulavel, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'produtos' and column_name = 'prazo_dias_uteis';

  if v_tipo is null then
    raise exception 'SAIDA: produtos.prazo_dias_uteis nao foi criada';
  end if;
  if v_tipo <> 'integer' then
    raise exception 'SAIDA: produtos.prazo_dias_uteis deveria ser integer, e %', v_tipo;
  end if;
  if v_nulavel <> 'YES' then
    raise exception 'SAIDA: produtos.prazo_dias_uteis deveria ser nulavel';
  end if;
  if v_default is not null then
    raise exception 'SAIDA: produtos.prazo_dias_uteis nao deveria ter default, tem %', v_default;
  end if;

  -- 8. O TEXTO NAO MUDOU. Contagem igual E hash de (id_produto, prazo) identico
  --    ao da entrada, linha a linha. Esta e a assercao central: a promessa desta
  --    migration e que produtos.prazo sai dela exatamente como entrou.
  select count(*) into v_linhas_d from public.produtos;

  select md5(coalesce(string_agg(id_produto::text || '|' || coalesce(prazo, '(null)'), ',' order by id_produto), ''))
    into v_hash_prazo_d from public.produtos;

  if v_linhas_d <> v_linhas then
    raise exception 'SAIDA: produtos mudou de % para % linhas', v_linhas, v_linhas_d;
  end if;
  if v_hash_prazo_d <> v_hash_prazo then
    raise exception 'SAIDA: o TEXTO de produtos.prazo MUDOU (antes % / depois %)', v_hash_prazo, v_hash_prazo_d;
  end if;

  -- 9. Coerencia do backfill: toda linha preenchida veio de um dos quatro textos
  --    da lista, e todo texto da lista virou numero. Zero dos dois lados.
  select count(*) into v_nulas
    from public.produtos
   where btrim(prazo) in ('1 dia útil', '1 dia util', '2 dias úteis', '3 dias úteis')
     and prazo_dias_uteis is null;
  if v_nulas <> 0 then
    raise exception 'SAIDA: % linhas com texto conversivel ficaram sem numero', v_nulas;
  end if;

  select count(*) into v_nulas
    from public.produtos
   where prazo_dias_uteis is not null
     and btrim(prazo) not in ('1 dia útil', '1 dia util', '2 dias úteis', '3 dias úteis');
  if v_nulas <> 0 then
    raise exception 'SAIDA: % linhas receberam numero sem estar na lista de conversao', v_nulas;
  end if;

  -- 10. O AMBIGUO CONTINUA NULO. Texto com numero que nao fala em dias uteis nao
  --     pode ter virado numero — e a regra que separa esta migration de um chute.
  select count(*) into v_ambiguo
    from public.produtos
   where prazo is not null
     and btrim(prazo) <> ''
     and prazo !~* '(util|úti|úte)'
     and prazo_dias_uteis is not null;
  if v_ambiguo <> 0 then
    raise exception 'SAIDA: % linhas ambiguas (texto sem dias uteis) receberam numero — isso e um chute, aborte', v_ambiguo;
  end if;

  -- 11. Cadastro vazio continua nulo.
  select count(*) into v_nulas
    from public.produtos
   where (prazo is null or btrim(prazo) = '')
     and prazo_dias_uteis is not null;
  if v_nulas <> 0 then
    raise exception 'SAIDA: % linhas sem texto de prazo receberam numero', v_nulas;
  end if;

  -- 12. Faixa: o backfill so escreve 1, 2 ou 3. Valor fora disso significa que a
  --     lista de conversao foi mexida sem revisar esta assercao.
  select count(*) into v_nulas
    from public.produtos
   where prazo_dias_uteis is not null and prazo_dias_uteis not between 1 and 3;
  if v_nulas <> 0 then
    raise exception 'SAIDA: % linhas com prazo_dias_uteis fora de 1..3', v_nulas;
  end if;

  select count(*) into v_preenchidas from public.produtos where prazo_dias_uteis is not null;
  select count(*) into v_nulas       from public.produtos where prazo_dias_uteis is null;

  -- 13. Os numeros medidos em 08/09/2026: 68 preenchidas, 11 nulas. Nao aborta,
  --     porque o catalogo pode ter mudado entre escrever e aplicar.
  if v_preenchidas <> 68 or v_nulas <> 11 then
    raise notice 'AVISO: esperado 68 preenchidas e 11 nulas (medido em 08/09/2026), veio % e %', v_preenchidas, v_nulas;
  end if;

  raise notice 'SAIDA OK: coluna criada, % linhas com numero, % nulas, texto prazo intacto', v_preenchidas, v_nulas;
end
$migration$;

-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   Enquanto ninguem LER a coluna nova, o rollback nao perde nada que nao possa
--   ser refeito: todo valor dela e derivado do texto de produtos.prazo, que esta
--   intacto, pela mesma lista de conversao deste arquivo. Derrubar e recriar da
--   o mesmo resultado.
--
--   Isso deixa de valer no dia em que alguem EDITAR prazo_dias_uteis pela tela
--   sem editar o texto junto. A partir dai o valor nao e mais derivavel, e o
--   DROP apaga escolha humana. A assercao abaixo tenta perceber isso: ela aborta
--   se encontrar linha cujo numero nao corresponda ao texto — sinal de que
--   alguem ja escreveu ali por outro caminho.
--
--   do $rollback$
--   declare
--     v_divergentes bigint;
--   begin
--     select count(*) into v_divergentes
--       from public.produtos
--      where prazo_dias_uteis is not null
--        and prazo_dias_uteis <> case btrim(prazo)
--              when '1 dia útil'   then 1
--              when '1 dia util'   then 1
--              when '2 dias úteis' then 2
--              when '3 dias úteis' then 3
--            end;
--
--     if v_divergentes > 0 then
--       raise exception 'ROLLBACK ABORTADO: % linhas tem numero que nao vem do texto. Alguem editou a coluna. Exporte antes de derrubar.', v_divergentes;
--     end if;
--
--     alter table public.produtos drop column prazo_dias_uteis;
--
--     raise notice 'ROLLBACK OK: coluna removida, todo valor era derivavel do texto';
--   end
--   $rollback$;
--
--   DROP COLUMN e so catalogo: nao reescreve a tabela. O texto de produtos.prazo
--   nao e tocado nem na ida nem na volta.
--
--   A auditoria NAO volta: as 68 linhas que o backfill gerou em
--   audit.log_row_changes_v2 continuam la depois do rollback. Isso e registro do
--   que aconteceu, nao estado a desfazer.
-- ============================================================================
