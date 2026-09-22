-- Fecha a ESCRITA anonima em propostas, produtos_proposta e boletos
--
-- O QUE E
--   Duas mudancas, nas mesmas tres tabelas:
--
--   1. GRANT: `anon` perde INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
--      TRIGGER e MAINTAIN. MANTEM O SELECT — a leitura anonima e um problema
--      separado e fica para outra rodada, de proposito.
--
--   2. RLS: toda politica PERMISSIVA de INSERT, UPDATE ou DELETE que hoje vale
--      para PUBLIC passa a valer so para `authenticated`, recriada com o MESMO
--      using e o MESMO with check. Nenhuma politica de SELECT muda de alcance.
--      A politica `debug_update_all_roles` de produtos_proposta e removida, nao
--      recriada: ela duplica `authenticated_can_update_produtos_proposta`, que
--      ja cobre o mesmo UPDATE para o mesmo papel.
--
-- POR QUE
--   Medido em 22/09/2026 com a chave anonima do projeto, sem sessao nenhuma:
--   as tres tabelas respondiam 206 com linha. Alem de ler, `anon` tinha grant
--   de INSERT, UPDATE e DELETE e politicas permissivas TO PUBLIC com
--   `using (true)` / `with check (true)` — ou seja, a chave que qualquer um
--   copia do navegador podia mudar o valor de um item, reescrever uma proposta
--   ou apagar um boleto. Aqui a RLS nao segurava nada: PUBLIC inclui `anon`.
--
--   Nenhum consumidor oficial depende disso. As rotas `/api/**` usam a anon key
--   apenas como `apikey`, sempre junto do `Bearer` do usuario (papel efetivo:
--   `authenticated`); o n8n usa service_role; e o QR da OS chama as RPCs
--   `os_qr_*`, todas SECURITY DEFINER da dona `postgres`, com
--   `relforcerowsecurity = false` nas tres tabelas — passam ao largo da RLS e
--   nao dependem de politica nenhuma.
--
-- DE ONDE VIERAM ESSAS POLITICAS
--   De fora do versionamento. Nenhuma migration do repositorio e nenhuma linha
--   de `supabase_migrations.schema_migrations` as cria: foram feitas pelo painel
--   ou pelo SQL editor. Pela ordem de OID, as quatro `allow_*_produtos_proposta`
--   nasceram junto com a propria tabela e `debug_update_all_roles` logo depois —
--   o prefixo `debug_` diz o resto: era temporaria e ficou. As de `propostas` e
--   a `geral` de `boletos` sao da mesma epoca. Esta migration e a primeira vez
--   que elas entram no versionamento; por isso o rollback abaixo as reescreve
--   por inteiro.
--
-- POR QUE BOLETOS GANHA UMA POLITICA DE SELECT NOVA
--   `boletos` tinha UMA politica, `geral`, FOR ALL TO PUBLIC. Ela e ao mesmo
--   tempo o SELECT do `anon` e a escrita que esta rodada corta. Restringi-la a
--   `authenticated` cortaria tambem a leitura, o que esta rodada NAO quer.
--   Entao ela e recriada TO authenticated e entra, no lugar da metade que some,
--   `boletos_select_publico_legado`: FOR SELECT TO PUBLIC com o mesmo
--   `using (true)`. A leitura anonima de boletos continua exatamente como
--   estava, isolada numa politica que a proxima rodada derruba sozinha.
--
--   `propostas` e `produtos_proposta` nao precisam disso: as duas ja tinham
--   politicas de SELECT TO PUBLIC separadas, que esta migration nao toca.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao mexe em `pagamentos_v2` (onde `anon` ja nao tem grant de escrita), nem
--   em `clientes`, `enderecos` ou qualquer outra tabela. Nao revoga o SELECT de
--   `anon`. Nao tira nada de `authenticated`, `service_role` ou `postgres`. Nao
--   escreve um dado sequer.
--
-- SOBRE O LOCK
--   `create policy` e `drop policy` pegam lock exclusivo na tabela, e estas
--   tres estao em uso o dia inteiro. O `lock_timeout` abaixo faz a migration
--   DESISTIR em 5 segundos em vez de entrar na fila na frente da operacao: se
--   estourar, a transacao inteira volta atras e e so rodar de novo num momento
--   mais calmo.
--
-- ============================================================================

set local lock_timeout = '5s';

-- ============================================================================
-- 1. GRANTS — anon fica so com SELECT nas tres
-- ============================================================================

revoke insert, update, delete, truncate, references, trigger, maintain
  on public.propostas from anon;

revoke insert, update, delete, truncate, references, trigger, maintain
  on public.produtos_proposta from anon;

revoke insert, update, delete, truncate, references, trigger, maintain
  on public.boletos from anon;

-- ============================================================================
-- 2. propostas — as quatro politicas de escrita TO PUBLIC viram authenticated
--    Mesmo using, mesmo with check. As tres de SELECT TO PUBLIC
--    ("Enable read access for all users", "... juninho") ficam intocadas.
-- ============================================================================

-- FOR ALL: cobria SELECT e escrita. O SELECT do anon sobrevive pelas outras
-- duas politicas de leitura TO PUBLIC da tabela.
drop policy if exists "Enable read access for all" on public.propostas;
create policy "Enable read access for all"
  on public.propostas
  for all
  to authenticated
  using (true);

drop policy if exists "Permitir atualizar texto_whatsapp" on public.propostas;
create policy "Permitir atualizar texto_whatsapp"
  on public.propostas
  for update
  to authenticated
  using (true)
  with check (true);

-- Ja testava auth.role() = 'authenticated' no corpo; o TO authenticated agora
-- diz a mesma coisa no lugar certo.
drop policy if exists "UPDATE total autenticado" on public.propostas;
create policy "UPDATE total autenticado"
  on public.propostas
  for update
  to authenticated
  using (auth.role() = 'authenticated'::text);

drop policy if exists "DELETE total autenticado" on public.propostas;
create policy "DELETE total autenticado"
  on public.propostas
  for delete
  to authenticated
  using (auth.role() = 'authenticated'::text);

-- ============================================================================
-- 3. produtos_proposta — tres viram authenticated, a debug_ sai
--    As duas de SELECT TO PUBLIC ("allow_select_all_produtos_proposta",
--    "Enable read access for all produtos") ficam intocadas.
-- ============================================================================

drop policy if exists allow_insert_all_produtos_proposta on public.produtos_proposta;
create policy allow_insert_all_produtos_proposta
  on public.produtos_proposta
  for insert
  to authenticated
  with check (true);

drop policy if exists allow_update_all_produtos_proposta on public.produtos_proposta;
create policy allow_update_all_produtos_proposta
  on public.produtos_proposta
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists allow_delete_all_produtos_proposta on public.produtos_proposta;
create policy allow_delete_all_produtos_proposta
  on public.produtos_proposta
  for delete
  to authenticated
  using (true);

-- Removida, nao recriada: mesmo UPDATE, mesmo papel, ja coberto por
-- authenticated_can_update_produtos_proposta (UPDATE TO authenticated,
-- using true / with check true), que esta migration nao toca.
drop policy if exists debug_update_all_roles on public.produtos_proposta;

-- ============================================================================
-- 4. boletos — a unica politica se parte em duas: escrita para authenticated,
--    leitura publica preservada tal como estava
-- ============================================================================

drop policy if exists geral on public.boletos;
create policy geral
  on public.boletos
  for all
  to authenticated
  using (true)
  with check (true);

create policy boletos_select_publico_legado
  on public.boletos
  for select
  to public
  using (true);

comment on policy boletos_select_publico_legado on public.boletos is
  'Guarda a leitura publica que a antiga politica geral (FOR ALL TO PUBLIC) dava ao anon, sem a escrita que vinha junto. Existe so para esta rodada nao mexer no SELECT anonimo; a rodada que fechar a leitura anonima derruba esta politica.';

-- ============================================================================
-- 5. ASSERCOES — a migration prova o que prometeu, ou aborta a transacao
-- ============================================================================

do $$
declare
  r                 record;
  v_privs           text[];
  v_esperado_outros text[] := array['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'];
  v_publicas        text;
  v_papeis          text[];
  v_papel           text;
  v_usando          text;
  v_checando        text;
  v_le              boolean;
begin
  -- 5.1 anon fica EXATAMENTE com SELECT nas tres; authenticated, service_role e
  --     postgres nao perdem nada.
  for r in select unnest(array['propostas','produtos_proposta','boletos']) as t loop
    select array_agg(distinct a.privilege_type order by a.privilege_type)
      into v_privs
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace,
           aclexplode(c.relacl) a
     where n.nspname = 'public' and c.relname = r.t
       and pg_get_userbyid(a.grantee) = 'anon';

    if v_privs is distinct from array['SELECT'] then
      raise exception 'ASSERCAO 1 FALHOU: anon em % deveria ficar so com SELECT, esta com %', r.t, v_privs;
    end if;

    foreach v_papel in array array['authenticated','service_role','postgres'] loop
      select array_agg(distinct a.privilege_type order by a.privilege_type)
        into v_privs
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace,
             aclexplode(c.relacl) a
       where n.nspname = 'public' and c.relname = r.t
         and pg_get_userbyid(a.grantee) = v_papel;

      if v_privs is distinct from v_esperado_outros then
        raise exception 'ASSERCAO 2 FALHOU: % perdeu privilegio em % (ficou com %)', v_papel, r.t, v_privs;
      end if;
    end loop;

    -- 5.2 anon continua LENDO: grant de SELECT (acima) mais pelo menos uma
    --     politica permissiva de leitura que alcance PUBLIC ou anon.
    select exists (
      select 1 from pg_policy p
       where p.polrelid = ('public.'||r.t)::regclass
         and p.polpermissive
         and p.polcmd in ('r', '*')
         and (p.polroles is null
              or 0 = any(p.polroles)
              or exists (select 1 from unnest(p.polroles) x where pg_get_userbyid(x) = 'anon'))
    ) into v_le;

    if not v_le then
      raise exception 'ASSERCAO 3 FALHOU: % ficou sem politica de SELECT que alcance o anon', r.t;
    end if;

    -- 5.3 NENHUMA politica de escrita (INSERT/UPDATE/DELETE/ALL) alcancando
    --     PUBLIC ou anon nas tres.
    select string_agg(p.polname||' ('||p.polcmd::text||')', ', ')
      into v_publicas
      from pg_policy p
     where p.polrelid = ('public.'||r.t)::regclass
       and p.polcmd in ('a', 'w', 'd', '*')
       and (p.polroles is null
            or 0 = any(p.polroles)
            or exists (select 1 from unnest(p.polroles) x where pg_get_userbyid(x) = 'anon'));

    if v_publicas is not null then
      raise exception 'ASSERCAO 4 FALHOU: % ainda tem politica de escrita para PUBLIC/anon: %', r.t, v_publicas;
    end if;
  end loop;

  -- 5.4 Cada politica recriada existe, e SO para authenticated, e com o MESMO
  --     using e with check de antes.
  for r in
    select * from (values
      ('propostas',         'Enable read access for all',                 '*', 'true',                                 null),
      ('propostas',         'Permitir atualizar texto_whatsapp',          'w', 'true',                                 'true'),
      ('propostas',         'UPDATE total autenticado',                   'w', '(auth.role() = ''authenticated''::text)', null),
      ('propostas',         'DELETE total autenticado',                   'd', '(auth.role() = ''authenticated''::text)', null),
      ('produtos_proposta', 'allow_insert_all_produtos_proposta',         'a', null,                                   'true'),
      ('produtos_proposta', 'allow_update_all_produtos_proposta',         'w', 'true',                                 'true'),
      ('produtos_proposta', 'allow_delete_all_produtos_proposta',         'd', 'true',                                  null),
      ('boletos',           'geral',                                      '*', 'true',                                 'true')
    ) as v(tabela, politica, cmd, usando, checando)
  loop
    select array_agg(pg_get_userbyid(x) order by pg_get_userbyid(x)),
           pg_get_expr(p.polqual, p.polrelid),
           pg_get_expr(p.polwithcheck, p.polrelid)
      into v_papeis, v_usando, v_checando
      from pg_policy p, unnest(p.polroles) x
     where p.polrelid = ('public.'||r.tabela)::regclass
       and p.polname = r.politica
       and p.polcmd::text = r.cmd
     group by p.polqual, p.polwithcheck, p.polrelid;

    if v_papeis is null then
      raise exception 'ASSERCAO 5 FALHOU: politica % sumiu de %', r.politica, r.tabela;
    end if;

    if v_papeis is distinct from array['authenticated'] then
      raise exception 'ASSERCAO 5 FALHOU: politica % de % deveria ser so TO authenticated, esta %',
        r.politica, r.tabela, v_papeis;
    end if;

    if v_usando is distinct from r.usando or v_checando is distinct from r.checando then
      raise exception 'ASSERCAO 5 FALHOU: politica % de % mudou de expressao (using=% esperado %, check=% esperado %)',
        r.politica, r.tabela, v_usando, r.usando, v_checando, r.checando;
    end if;
  end loop;

  -- 5.5 A debug_ saiu e a irma que a cobre continua de pe.
  if exists (select 1 from pg_policy where polrelid = 'public.produtos_proposta'::regclass
              and polname = 'debug_update_all_roles') then
    raise exception 'ASSERCAO 6 FALHOU: debug_update_all_roles continua em produtos_proposta';
  end if;

  if not exists (select 1 from pg_policy where polrelid = 'public.produtos_proposta'::regclass
                  and polname = 'authenticated_can_update_produtos_proposta' and polcmd = 'w') then
    raise exception 'ASSERCAO 6 FALHOU: authenticated_can_update_produtos_proposta sumiu — o UPDATE de authenticated ficaria descoberto';
  end if;

  raise notice 'OK: anon so com SELECT nas tres, nenhuma politica de escrita para PUBLIC/anon, authenticated e service_role intactos';
end $$;

-- ============================================================================
-- ROLLBACK (nao executar junto; copiar e rodar se precisar desfazer)
--
--   Devolve as tres tabelas ao estado de 22/09/2026, antes desta migration:
--   grants de escrita para anon e politicas de escrita valendo para PUBLIC.
--   ATENCAO: isso reabre a escrita anonima. So rode se um consumidor que o
--   mapeamento nao viu tiver quebrado, e de preferencia so na tabela dele.
--
--   -- grants
--   grant insert, update, delete, truncate, references, trigger, maintain
--     on public.propostas to anon;
--   grant insert, update, delete, truncate, references, trigger, maintain
--     on public.produtos_proposta to anon;
--   grant insert, update, delete, truncate, references, trigger, maintain
--     on public.boletos to anon;
--
--   -- propostas
--   drop policy if exists "Enable read access for all" on public.propostas;
--   create policy "Enable read access for all" on public.propostas
--     for all to public using (true);
--
--   drop policy if exists "Permitir atualizar texto_whatsapp" on public.propostas;
--   create policy "Permitir atualizar texto_whatsapp" on public.propostas
--     for update to public using (true) with check (true);
--
--   drop policy if exists "UPDATE total autenticado" on public.propostas;
--   create policy "UPDATE total autenticado" on public.propostas
--     for update to public using (auth.role() = 'authenticated'::text);
--
--   drop policy if exists "DELETE total autenticado" on public.propostas;
--   create policy "DELETE total autenticado" on public.propostas
--     for delete to public using (auth.role() = 'authenticated'::text);
--
--   -- produtos_proposta
--   drop policy if exists allow_insert_all_produtos_proposta on public.produtos_proposta;
--   create policy allow_insert_all_produtos_proposta on public.produtos_proposta
--     for insert to public with check (true);
--
--   drop policy if exists allow_update_all_produtos_proposta on public.produtos_proposta;
--   create policy allow_update_all_produtos_proposta on public.produtos_proposta
--     for update to public using (true) with check (true);
--
--   drop policy if exists allow_delete_all_produtos_proposta on public.produtos_proposta;
--   create policy allow_delete_all_produtos_proposta on public.produtos_proposta
--     for delete to public using (true);
--
--   create policy debug_update_all_roles on public.produtos_proposta
--     for update to public using (true) with check (true);
--
--   -- boletos
--   drop policy if exists boletos_select_publico_legado on public.boletos;
--   drop policy if exists geral on public.boletos;
--   create policy geral on public.boletos
--     for all to public using (true) with check (true);
-- ============================================================================
