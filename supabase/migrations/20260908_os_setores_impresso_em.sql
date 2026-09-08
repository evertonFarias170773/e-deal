-- Registro de impressao do boletim: propostas_os_setores.impresso_em
--
-- O QUE E
--   Uma coluna aditiva:
--
--     public.propostas_os_setores.impresso_em  timestamptz  NULA, SEM default
--
--   Guarda QUANDO o PDF daquele setor foi gerado pela ultima vez. Nula = nunca
--   impresso, e e o valor de partida de todas as 104 linhas existentes.
--
-- POR QUE
--   O boletim vai perguntar, ao salvar, se o operador quer gerar os PDF. Na
--   REIMPRESSAO a pergunta muda: em vez de gerar tudo direto, oferece "todos os
--   setores" ou "so o que foi editado". Para distinguir primeira impressao de
--   reimpressao e preciso saber se ja foi impresso — e ate 08/09/2026 isso nao
--   existia em lugar nenhum.
--
--   Levantado antes de escrever: nenhuma coluna de impressao em `propostas_os`
--   (21 colunas) nem em `propostas_os_setores` (14); `public.os_status_log`
--   registra transicao de status, nao impressao (origens EXPEDICAO_UI e
--   qr_producao); e a rota /api/pedidos/imprimir-os gera o PDF e nao grava nada.
--
-- POR QUE NA LINHA DO SETOR, E NAO NO PEDIDO
--   Porque a impressao E por setor: cada linha de `propostas_os_setores` produz
--   o seu proprio PDF, e a rota recebe um boletim por vez. Guardar no pedido
--   responderia "algum setor foi impresso", que nao basta para a pergunta "so o
--   setor editado".
--
-- ============================================================================
-- A TRAVA DE ADM NAO ALCANCA ESTA COLUNA — e isso e por construcao
-- ============================================================================
--   Esta tabela tem a trigger `trg_prazo_exige_adm`, criada em 08/09/2026:
--
--     BEFORE UPDATE OF prazo, hora ON public.propostas_os_setores
--
--   O `UPDATE OF <colunas>` do Postgres restringe o disparo as instrucoes que
--   MENCIONAM aquelas colunas. Um `UPDATE ... SET impresso_em = now()` nao
--   menciona `prazo` nem `hora`, entao a trigger NAO DISPARA e nenhuma checagem
--   de permissao acontece.
--
--   ISSO E NECESSARIO, nao um detalhe: quem imprime o boletim e a producao, e
--   producao nao e ADM. Se a gravacao do carimbo exigisse `pedidos.edit_data`,
--   imprimir passaria a ser privilegio de administrador — o oposto do desenho.
--
--   A trava continua inteira: alterar `prazo` ou `hora` segue exigindo
--   permissao, com as quatro folgas de sempre (INSERT, NULL -> valor, valor
--   igual, service_role). Esta migration NAO a altera.
--
--   !! CUIDADO PARA QUEM VIER DEPOIS: gravar `impresso_em` JUNTO com `prazo` ou
--   !! `hora` no MESMO UPDATE faria a trigger disparar, e a impressao passaria a
--   !! exigir ADM. O carimbo deve ir sempre em UPDATE proprio.
--
-- ============================================================================
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
-- ============================================================================
--   Nao faz backfill: as 104 linhas ficam NULAS, e nulo significa "nunca
--   impresso". Inventar uma data de impressao passada seria mentira — e faria o
--   modal oferecer reimpressao para quem nunca imprimiu.
--   Nao cria default, CHECK, FK, indice, trigger, funcao nem politica.
--   Nao altera a trigger da trava de ADM, nem a RLS, nem as 4 politicas da
--   tabela. Nao emite GRANT nem REVOKE.
--   Nao altera nenhuma coluna existente.
--   Nao toca em propostas_os, feriados, soma_dias_uteis, produtos,
--   cotacao_frete, pagamentos_v2 nem Conta Corrente.
--
-- ============================================================================
-- MEDIDO NO BANCO EM 08/09/2026, ANTES DE ESCREVER
-- ============================================================================
--   public.propostas_os_setores ..... 104 linhas, 14 colunas
--                                     impresso_em NAO existe
--                                     RLS ligada, 4 politicas
--                                     1 trigger: trg_prazo_exige_adm
-- ============================================================================

do $migration$
declare
  v_linhas      bigint;
  v_linhas_d    bigint;
  v_tipo        text;
  v_nulavel     text;
  v_default     text;
  v_preenchidas bigint;
  v_triggers    bigint;
  v_politicas   bigint;
begin
  -- ==========================================================================
  -- ASSERCOES DE ENTRADA
  -- ==========================================================================

  if to_regclass('public.propostas_os_setores') is null then
    raise exception 'ENTRADA: public.propostas_os_setores nao existe';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'propostas_os_setores'
       and column_name = 'impresso_em'
  ) then
    raise exception 'ENTRADA: propostas_os_setores.impresso_em JA existe — confira antes';
  end if;

  -- A trigger da trava tem que continuar existindo e continuar restrita a
  -- prazo/hora. Se alguem a tiver trocado por um BEFORE UPDATE sem lista de
  -- colunas, a coluna nova passaria a exigir ADM para ser gravada.
  select count(*) into v_triggers
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public'
     and c.relname = 'propostas_os_setores' and t.tgname = 'trg_prazo_exige_adm'
     and pg_get_triggerdef(t.oid) like '%UPDATE OF prazo, hora%';
  if v_triggers <> 1 then
    raise exception 'ENTRADA: trg_prazo_exige_adm nao esta como BEFORE UPDATE OF prazo, hora — impresso_em cairia na trava';
  end if;

  select count(*) into v_linhas from public.propostas_os_setores;
  raise notice 'ENTRADA: % linhas em propostas_os_setores', v_linhas;

  select count(*) into v_politicas
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'propostas_os_setores';

  -- ==========================================================================
  -- A COLUNA
  -- ==========================================================================
  -- ADD COLUMN timestamptz NULL SEM DEFAULT: so catalogo. Nao reescreve a
  -- tabela, nao dispara trigger de linha, nao move nada.
  alter table public.propostas_os_setores add column impresso_em timestamptz;

  comment on column public.propostas_os_setores.impresso_em is
    'Quando o PDF DESTE setor foi gerado pela ultima vez. Nula = nunca impresso. Serve para o boletim distinguir primeira impressao de REimpressao: na primeira ele gera todos os setores direto, na reimpressao pergunta se quer todos ou so o setor editado. Grave SEMPRE em UPDATE proprio: junto com prazo ou hora, a trigger trg_prazo_exige_adm dispara e a impressao passaria a exigir perfil ADM.';

  -- ==========================================================================
  -- ASSERCOES DE SAIDA
  -- ==========================================================================

  select data_type, is_nullable, column_default
    into v_tipo, v_nulavel, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'propostas_os_setores'
     and column_name = 'impresso_em';

  if v_tipo is null then
    raise exception 'SAIDA: impresso_em nao foi criada';
  end if;
  if v_tipo <> 'timestamp with time zone' then
    raise exception 'SAIDA: impresso_em deveria ser timestamptz, e %', v_tipo;
  end if;
  if v_nulavel <> 'YES' then
    raise exception 'SAIDA: impresso_em deveria ser nulavel';
  end if;
  if v_default is not null then
    raise exception 'SAIDA: impresso_em nao deveria ter default, tem %', v_default;
  end if;

  -- SEM BACKFILL: toda linha nula.
  select count(*) into v_preenchidas
    from public.propostas_os_setores where impresso_em is not null;
  if v_preenchidas <> 0 then
    raise exception 'SAIDA: esta migration nao faz backfill, mas % linhas tem impresso_em', v_preenchidas;
  end if;

  -- Nenhuma linha foi tocada.
  select count(*) into v_linhas_d from public.propostas_os_setores;
  if v_linhas_d <> v_linhas then
    raise exception 'SAIDA: a tabela mudou de % para % linhas', v_linhas, v_linhas_d;
  end if;

  -- A trava de ADM continua exatamente como estava.
  select count(*) into v_triggers
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public'
     and c.relname = 'propostas_os_setores' and t.tgname = 'trg_prazo_exige_adm'
     and pg_get_triggerdef(t.oid) like '%UPDATE OF prazo, hora%';
  if v_triggers <> 1 then
    raise exception 'SAIDA: a trigger da trava de ADM mudou';
  end if;

  -- RLS e politicas intocadas.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname='propostas_os_setores' and c.relrowsecurity
  ) then
    raise exception 'SAIDA: RLS de propostas_os_setores saiu do ar';
  end if;

  if (select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname='propostas_os_setores') <> v_politicas then
    raise exception 'SAIDA: o numero de politicas mudou';
  end if;

  raise notice 'SAIDA OK: impresso_em criada (timestamptz, nula, sem default), % linhas intactas e nulas', v_linhas_d;
  raise notice 'SAIDA OK: trava de ADM intacta (UPDATE OF prazo, hora) e % politicas de RLS', v_politicas;
end
$migration$;

-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   DROP COLUMN apaga o historico de impressao. Enquanto o modal do boletim
--   estiver lendo a coluna, derruba-la faz TODA reimpressao voltar a se
--   comportar como primeira impressao — gera todos os setores sem perguntar.
--   Nao quebra nada, mas muda o fluxo.
--
--   Nao ha o que exportar: o valor e derivavel do uso futuro, nao de dado
--   historico. Antes de 08/09/2026 ele simplesmente nao existia.
--
--   alter table public.propostas_os_setores drop column impresso_em;
--
--   DROP COLUMN tambem e so catalogo: nao reescreve a tabela e nao dispara a
--   trigger da trava.
-- ============================================================================
