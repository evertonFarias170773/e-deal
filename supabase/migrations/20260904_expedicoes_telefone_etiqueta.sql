-- expedicoes.telefone_etiqueta — o telefone que VAI IMPRESSO, editado na expedicao
--
-- O QUE MUDA
--   Uma coluna em `public.expedicoes`: `telefone_etiqueta text NULL`, sem
--   default, sem check, sem trigger, sem RLS nova, sem backfill. Nada mais.
--   Nenhuma linha existente e lida ou escrita; `public.clientes` fica de fora.
--
-- POR QUE
--   O telefone da etiqueta 10x15 (e o que a prepostagem dos Correios envia) e
--   resolvido do CADASTRO pela regra de `lib/telefone-destinatario.ts`:
--   `whatsapp_1` se for telefone, senao `telefone_fixo`. O expedidor nao tinha
--   como ajustar o numero que sai no volume sem mexer no cadastro do cliente —
--   e mexer no cadastro por causa de UMA remessa e o erro que se quer evitar.
--   Decisao do dono em 04/09/2026: o telefone impresso e dado da EXPEDICAO,
--   como `obs_etiqueta` e `nf_numero_manual` ja sao, e mora na mesma linha.
--
-- SEMANTICA (vive no codigo, nao aqui)
--   NULL       segue o cadastro pela regra de `telefone-destinatario.ts`
--              — e por isso a coluna NASCE NULA em toda a base e NAO recebe
--              backfill: nula, ela nao muda nada do que ja e impresso hoje;
--   preenchido vence, na 10x15, na previa do modal, na conferencia dos
--              Correios e na prepostagem gerada DEPOIS de gravado. Prepostagem
--              ja emitida nao muda: nome, endereco e telefone congelam nos
--              Correios na criacao do objeto.
--   O modal so grava quando o expedidor ALTERA o valor que a regra resolveu;
--   o cadastro (`clientes.whatsapp_1`, `clientes.telefone_fixo`) nunca e
--   tocado por este caminho.
--
-- POR QUE UMA COLUNA NOVA
--   Conferido em 04/09/2026: nenhuma das 36 colunas de `expedicoes` guarda
--   telefone, e as duas de texto livre tem dono — `obs` e recado interno da
--   bancada, `obs_etiqueta` e a observacao impressa. `pesos_volumes` e o JSON
--   de pesos da Revisao do boletim. Reusar qualquer uma trocaria o significado
--   de dado que ja esta gravado.
--
-- O QUE NAO MUDA
--   - nenhum trigger dispara: `public.expedicoes` NAO TEM TRIGGER (assercao de
--     entrada), e `ADD COLUMN` nulavel sem default nao reescreve a tabela;
--   - `updated_at` de nenhuma linha muda (assercao de saida);
--   - nenhuma outra tabela, funcao, policy ou permissao e tocada.
--
-- MEDIDO ANTES DE APLICAR (04/09/2026, ~17:40 UTC)
--   59 linhas em `expedicoes`, 0 triggers, coluna `telefone_etiqueta` ausente,
--   `obs_etiqueta` e `nf_numero_manual` presentes (as irmas desta coluna).
--
-- AUTORIZACAO
--   Escrita autorizada pelo dono em 04/09/2026 para ESTE `ALTER TABLE` e
--   somente para ele. Por isso nao ha `COMMENT ON COLUMN` aqui — a semantica
--   fica neste cabecalho e no codigo.

begin;

-- 1. ASSERCOES DE ENTRADA -----------------------------------------------------
do $$
declare
  v_irmas int;
  v_trg   int;
begin
  perform 1
  from information_schema.tables
  where table_schema = 'public' and table_name = 'expedicoes';
  if not found then
    raise exception 'ABORTADO: public.expedicoes nao existe.';
  end if;

  perform 1
  from information_schema.columns
  where table_schema = 'public' and table_name = 'expedicoes'
    and column_name = 'telefone_etiqueta';
  if found then
    raise exception 'ABORTADO: public.expedicoes.telefone_etiqueta ja existe. Migration ja aplicada?';
  end if;

  -- As colunas irmas (mesma familia: dados da etiqueta gravados na expedicao)
  -- precisam estar la — e a premissa de que esta coluna mora na linha certa.
  select count(*) into v_irmas
  from information_schema.columns
  where table_schema = 'public' and table_name = 'expedicoes'
    and column_name in ('obs_etiqueta', 'nf_numero_manual');
  if v_irmas <> 2 then
    raise exception 'ABORTADO: esperadas obs_etiqueta e nf_numero_manual em expedicoes, encontradas %.', v_irmas;
  end if;

  select count(*) into v_trg
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname = 'public' and c.relname = 'expedicoes';
  if v_trg <> 0 then
    raise exception 'ABORTADO: public.expedicoes passou a ter % trigger(s). A premissa de que o ADD COLUMN nao dispara nada deixou de valer — reconferir antes de aplicar.', v_trg;
  end if;

  raise notice 'Entrada OK: tabela presente, telefone_etiqueta ausente, irmas presentes, zero triggers.';
end $$;

-- 2. A COLUNA -----------------------------------------------------------------
--    Nulavel e sem default de proposito: NULL e "segue o cadastro". Um default
--    faria toda linha existente nascer com telefone fixado na expedicao.
alter table public.expedicoes add column telefone_etiqueta text null;

-- 3. ASSERCOES DE SAIDA -------------------------------------------------------
do $$
declare
  r           record;
  v_nao_nulas int;
  v_tocadas   int;
begin
  select column_name, data_type, is_nullable, column_default into r
  from information_schema.columns
  where table_schema = 'public' and table_name = 'expedicoes'
    and column_name = 'telefone_etiqueta';
  if not found then
    raise exception 'ABORTADO: telefone_etiqueta nao foi criada.';
  end if;
  if r.data_type <> 'text' then
    raise exception 'ABORTADO: telefone_etiqueta nasceu como %, esperado text.', r.data_type;
  end if;
  if r.is_nullable <> 'YES' then
    raise exception 'ABORTADO: telefone_etiqueta nasceu NOT NULL.';
  end if;
  if r.column_default is not null then
    raise exception 'ABORTADO: telefone_etiqueta nasceu com default (%).', r.column_default;
  end if;

  select count(*) into v_nao_nulas
  from public.expedicoes
  where telefone_etiqueta is not null;
  if v_nao_nulas <> 0 then
    raise exception 'ABORTADO: % linha(s) nasceram com telefone_etiqueta preenchido.', v_nao_nulas;
  end if;

  -- Nenhuma linha foi tocada nesta transacao: `now()` e o inicio da transacao,
  -- e qualquer UPDATE feito por ela carimbaria updated_at >= now(). (Um UPDATE
  -- concorrente do app que comitou entre o inicio e o lock do ALTER tambem
  -- cairia aqui — nesse caso a migration aborta inteira, sem efeito, e basta
  -- reaplicar.)
  select count(*) into v_tocadas
  from public.expedicoes
  where updated_at >= now();
  if v_tocadas <> 0 then
    raise exception 'ABORTADO: % linha(s) com updated_at >= inicio da transacao. Alguma coisa escreveu em expedicoes durante a migration.', v_tocadas;
  end if;

  raise notice 'Saida OK: telefone_etiqueta text nulavel sem default, todas as linhas nulas, nenhum updated_at tocado.';
end $$;

commit;

-- 4. CONFERENCIA POS-APLICACAO (somente leitura) ------------------------------
--
--    4.1 A coluna (esperado: text / YES / default nulo)
--
--      select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema='public' and table_name='expedicoes'
--        and column_name='telefone_etiqueta';
--
--    4.2 Nenhum trigger apareceu (esperado: 0)
--
--      select count(*) from pg_trigger t
--      join pg_class c on c.oid=t.tgrelid
--      join pg_namespace n on n.oid=c.relnamespace
--      where not t.tgisinternal and n.nspname='public' and c.relname='expedicoes';
--
--    4.3 Todas nulas e updated_at parado (esperado: mesmo count e mesmo
--        max(updated_at) do SELECT feito antes de aplicar; 0 preenchidas)
--
--      select count(*) as linhas,
--             count(telefone_etiqueta) as com_telefone,
--             max(updated_at) as max_updated_at
--      from public.expedicoes;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   A coluna e aditiva e nasce nula em toda a base: derruba-la devolve o
--   estado anterior byte a byte, desde que o app ainda nao esteja gravando
--   nela. Se ja estiver, DROP apaga os telefones editados na expedicao — e ai
--   o caminho e parar de gravar primeiro (reverter o commit do app).
--
--   Nenhum outro objeto foi criado. Nenhum dado foi alterado.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- alter table public.expedicoes drop column telefone_etiqueta;
