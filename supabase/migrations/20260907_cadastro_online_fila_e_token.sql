-- =====================================================================
-- Cadastro online: a fila de aprovacao e o token do vendedor
-- =====================================================================
--
-- !! ESTA MIGRATION AINDA NAO FOI APLICADA. Escrita em 07/09/2026 para leitura
-- !! e aprovacao antes de rodar.
--
-- O QUE
-- -----
-- Etapa 1 de 2 do cadastro online. Cria SO banco:
--
--   public.cadastro_links      1 token por vendedor, espelhando os_qr_tokens
--   public.cadastros_online    a fila: o que o cliente enviou, aguardando aprovacao
--   cadastro_link_resolver()   valida o token e diz de quem e o link
--   cadastro_online_registrar()grava um envio na fila, com rate limit
--
-- Tudo aditivo. Nenhuma tabela, policy, grant ou funcao existente e tocada.
-- Nenhuma linha e lida, escrita ou apagada. As telas sao a Etapa 2.
--
-- POR QUE A FILA, E NAO ESCRITA DIRETA EM `clientes`
-- --------------------------------------------------
-- Decisao do dono. E o levantamento reforca: `enderecos` e `contatos` exigem
-- `id_cliente` NOT NULL sem default, e esse numero so existe DEPOIS da aprovacao
-- (nasce de `fn_proximo_id_cliente()` no insert de `clientes`). Escrever direto
-- exigiria criar o cliente antes de alguem olhar — que e exatamente o que a fila
-- evita. Cadastro abandonado, duplicado ou recusado tambem nao queima numeracao.
--
-- O QUE `clientes` EXIGE DE FATO (levantado, nao presumido — 07/09/2026)
-- ----------------------------------------------------------------------
-- No banco, quase nada: so `nome` e NOT NULL, e ainda com default ''. Todo o
-- resto tem default — `id_cliente` (fn_proximo_id_cliente), `categoria`
-- ('CLIENTE'), `padrao_pagamento` ('Pix a vista 3 dias'), `ativo`, `nota`.
--
-- NENHUM campo e impossivel para o cliente final. O que a aplicacao exige a mais
-- — documento valido, atendente, e-mail OU whatsapp — o cliente preenche ou vem
-- do token. O que e interno — categoria, ins_estadual, tipo_contribuinte,
-- limite_credito, empresa_padrao — fica com o atendente na aprovacao.
--
-- O E-MAIL, PENSANDO NA AREA DO CLIENTE
-- -------------------------------------
-- A extensao `citext` NAO existe neste banco (conferido em pg_extension), entao
-- `a@x.com` e `A@X.com` seriam valores distintos. Por isso `email` guarda o que
-- a pessoa digitou e `email_normalizado` e coluna GERADA `lower(btrim(email))`,
-- indexada. E ela que casa com `auth.users.email` quando o login existir.
--
-- Unicidade NAO: duas pessoas da mesma empresa podem enviar, e o mesmo cliente
-- pode reenviar por nao ter tido resposta. Barrar no envio ainda transformaria o
-- endpoint num oraculo de "esse e-mail ja se cadastrou". A duplicidade e
-- resolvida na aprovacao, junto com a de documento.
--
-- `auth_user_id` nasce AQUI, nulavel, com FK para auth.users. Com a tabela vazia
-- a FK valida instantaneamente; criada depois, exigiria varredura e lock numa
-- tabela povoada. E o requisito do dono: ligar o acesso depois sem migration em
-- tabela cheia. Nada de autenticacao e implementado agora — a coluna fica nula.
--
-- DECISAO QUE FICA EM ABERTO, e nao bloqueia esta migration: quando o cliente
-- logar, a identidade e a PESSOA ou o CADASTRO? 1:1 quebra quando o mesmo CNPJ
-- tem dois compradores, ou a mesma pessoa responde por matriz e filial. N:N pede
-- uma `clientes_usuarios` com papel. A fila fica correta nos dois cenarios,
-- porque `auth_user_id` aqui significa "quem enviou", nao "quem manda no
-- cadastro".
--
-- IP E USER_AGENT
-- ---------------
-- Nenhum dos dois em claro. So `ip_hash`, no padrao de `hashIpOsQr` que ja
-- existe: HMAC-SHA256 do IP com segredo, truncado em 32 chars. Serve para
-- correlacionar abuso sem guardar o endereco. `user_agent` foi descartado por
-- inteiro — nao houve uso que justificasse o dado.
--
-- O TOKEN DO VENDEDOR
-- -------------------
-- Espelha `os_qr_tokens`: HMAC deterministico, so o hash no banco, revogacao por
-- versao, rate limit persistente na propria linha. Mesmas colunas, mesmos nomes.
--
-- LINK CURTO SEM TERCEIRO. O os_qr usa 64 chars hex, que dariam uma URL de ~100
-- caracteres — ruim para WhatsApp. Aqui o token e o HMAC-SHA256 TRUNCADO EM 16
-- BYTES e codificado em base64url: 22 caracteres.
--
--   https://vibe.ai-ideal.com.br/c/Vt7kQ2mXpL9nR4sB8dF1gA      ~45 caracteres
--
-- 128 bits de entropia, inquebravel por forca bruta, e ainda com rate limit no
-- servidor. Sem encurtador externo e sem tabela de mapeamento: o token continua
-- derivavel do segredo, entao o link e fixo e permanente sem escrita.
-- O `token_hash` guardado e o sha256 da string de 22 chars.
--
-- COMO SE SABE QUE O VENDEDOR SAIU
-- --------------------------------
-- Nao ha sinal confiavel hoje, e o proprio codigo admite —
-- `cadastros.service.ts:2301`: "public.usuarios nao tem coluna de ativo/inativo,
-- entao nao ha filtro de atividade a preservar aqui". Confirmado no catalogo:
-- `usuarios` tem is_vendedor, id_perfil, is_admin, e NENHUMA coluna de status.
--
-- Entao `cadastro_link_resolver` confere CINCO sinais NO MOMENTO DO USO, nao na
-- emissao:
--   1. a linha existe em public.usuarios;
--   2. is_vendedor = true;
--   3. o perfil nao e 'pendente_aprovacao';
--   4. auth.users.banned_until esta nulo ou no passado;
--   5. auth.users.deleted_at esta nulo.
--
-- Banir pelo painel do Supabase ja invalida o link, sem ninguem lembrar de
-- revogar token. Nao criei coluna em `usuarios` — seria mudanca fora do escopo.
--
-- POR QUE ROUTE HANDLER, E NAO RPC EXPOSTA AO ANON
-- ------------------------------------------------
-- A escrita publica passa por Route Handler com service_role. O `anon` NAO ganha
-- nada: nem grant de tabela, nem grant de funcao. A superficie publica do banco
-- fica exatamente como esta.
--
-- Uma RPC com EXECUTE para anon seria mais um objeto da classe que causou os
-- problemas desta semana: 70 funcoes abertas ao anon, 4 reconcedidas fora do
-- versionamento, e um default privilege que AINDA nao suprime o PUBLIC em funcao
-- nova. Cada RPC nesse regime e divida que alguem precisa lembrar de fechar.
--
-- Mas a licao do os_qr fica: a autorizacao mora no banco, atomica. As duas
-- funcoes abaixo nascem com EXECUTE so para `service_role`, fechadas na mao
-- AQUI, com `revoke ... from public, anon` explicito — REVOKE FROM PUBLIC nao
-- alcanca grant nominal ao anon.
--
-- RATE LIMIT E HONEYPOT
-- ---------------------
-- Por token: 20 envios por hora, persistente na linha, serializado por FOR
-- UPDATE, igual ao os_qr. Vinte e nao cinco porque o link e do vendedor e pode
-- ir para varios clientes no mesmo dia; apertar demais bloquearia campanha
-- legitima. Ao estourar, a resposta e a MESMA mensagem neutra de token invalido:
-- nao se informa que existe limite.
--
-- Por IP fica na rota, em memoria (`rateLimitCheck`), 5 por 10 min — primeira
-- linha barata. A defesa real e a persistente por token.
--
-- Honeypot nao chega ao banco: e checado na rota, e o envio e descartado com
-- resposta 200 identica a de sucesso. `cadastro_links.descartes_honeypot` conta
-- os descartes, para dar visibilidade de link virando alvo.
-- =====================================================================

-- ------------------------------------------------------------------
-- 1. ASSERCOES DE ENTRADA
-- ------------------------------------------------------------------
do $entrada$
begin
  if to_regclass('public.cadastro_links') is not null
     or to_regclass('public.cadastros_online') is not null then
    raise exception 'ABORTADO: cadastro_links e/ou cadastros_online ja existem. Esta migration e de criacao.';
  end if;

  if to_regclass('public.usuarios') is null or to_regclass('auth.users') is null then
    raise exception 'ABORTADO: public.usuarios ou auth.users nao existe.';
  end if;

  -- o resolver depende de auth.users.banned_until e deleted_at
  if not exists (select 1 from information_schema.columns
                  where table_schema='auth' and table_name='users' and column_name='banned_until')
     or not exists (select 1 from information_schema.columns
                  where table_schema='auth' and table_name='users' and column_name='deleted_at') then
    raise exception 'ABORTADO: auth.users nao tem banned_until e/ou deleted_at — o resolver perderia dois dos cinco sinais de saida do vendedor.';
  end if;

  -- pgcrypto vive em `extensions` no Supabase (mesma pegadinha de 20260723_os_qr_digest_fix)
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
                  where e.extname='pgcrypto' and n.nspname='extensions') then
    raise exception 'ABORTADO: pgcrypto nao esta no schema extensions — o digest do token nao resolveria.';
  end if;

  raise notice 'Entrada OK: tabelas ausentes, usuarios e auth.users presentes, pgcrypto em extensions.';
end
$entrada$;

-- ------------------------------------------------------------------
-- 2. O TOKEN DO VENDEDOR — espelho de os_qr_tokens
-- ------------------------------------------------------------------
create table public.cadastro_links (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),
  id_vendedor         uuid        not null,
  versao              integer     not null default 1,
  -- sha256 hex do token de 22 chars derivado por HMAC no backend.
  -- O token em claro NUNCA chega ao banco.
  token_hash          text        not null unique,
  created_by          uuid,
  revoked_at          timestamptz,
  revoked_by          uuid,
  last_used_at        timestamptz,
  uso_count           integer     not null default 0,
  descartes_honeypot  integer     not null default 0,
  -- rate limit persistente por token, janela fixa, serializado por FOR UPDATE
  rl_janela_inicio    timestamptz,
  rl_tentativas       integer     not null default 0,
  unique (id_vendedor, versao)
);

-- 1 link ATIVO por vendedor
create unique index uidx_cadastro_links_ativo
  on public.cadastro_links (id_vendedor) where revoked_at is null;

comment on table public.cadastro_links is
  'Um link fixo por vendedor para o cadastro online. Espelha os_qr_tokens: HMAC deterministico, so o hash aqui, revogacao por versao, rate limit na propria linha.';

-- ------------------------------------------------------------------
-- 3. A FILA
-- ------------------------------------------------------------------
create table public.cadastros_online (
  id                  uuid primary key default gen_random_uuid(),
  criado_em           timestamptz not null default now(),

  -- origem: de quem era o link
  id_vendedor         uuid        not null,
  nome_vendedor       text,
  id_link             bigint      not null references public.cadastro_links(id),

  -- o que o cliente preenche
  documento           text        not null,
  documento_digitos   text generated always as (regexp_replace(coalesce(documento,''), '\D', '', 'g')) stored,
  tipo_pessoa         text        not null check (tipo_pessoa in ('FISICA','JURIDICA')),
  nome                text        not null,
  fantasia            text,
  email               text,
  -- lower(btrim(...)) porque a extensao citext NAO existe neste banco.
  -- E esta coluna que casara com auth.users.email quando o login existir.
  email_normalizado   text generated always as (lower(btrim(coalesce(email,'')))) stored,
  whatsapp            text,
  telefone_fixo       text,
  cep                 text,
  endereco            text,
  numero              text,
  complemento         text,
  bairro              text,
  cidade              text,
  uf                  text check (uf is null or length(uf) = 2),

  -- fila
  status              text        not null default 'PENDENTE'
                        check (status in ('PENDENTE','APROVADO','RECUSADO')),
  aprovado_em         timestamptz,
  aprovado_por        uuid,
  id_cliente_gerado   integer,           -- so na aprovacao
  motivo_recusa       text,

  -- consentimento: pertence ao ENVIO, nao ao cadastro consolidado
  consentimento_em     timestamptz not null,
  consentimento_texto  text        not null,
  consentimento_versao text        not null,

  -- anti-abuso. IP so em hash (HMAC truncado, padrao hashIpOsQr).
  -- user_agent NAO e gravado, nem cru nem em hash.
  ip_hash             text,

  -- area do cliente, no futuro. Nulavel, sem uso hoje: criada AGORA com a
  -- tabela vazia para que ligar o login depois nao exija migration em tabela
  -- povoada. `on delete set null` para que apagar o login nao apague o envio.
  auth_user_id        uuid references auth.users(id) on delete set null,

  constraint cadastros_online_aprovado_coerente check (
    (status = 'APROVADO'  and aprovado_em is not null and id_cliente_gerado is not null)
    or (status = 'RECUSADO' and aprovado_em is not null)
    or (status = 'PENDENTE' and aprovado_em is null and id_cliente_gerado is null)
  )
);

create index idx_cadastros_online_status      on public.cadastros_online (status, criado_em desc);
create index idx_cadastros_online_vendedor    on public.cadastros_online (id_vendedor, status);
create index idx_cadastros_online_documento   on public.cadastros_online (documento_digitos);
create index idx_cadastros_online_email       on public.cadastros_online (email_normalizado)
  where email_normalizado <> '';

comment on table public.cadastros_online is
  'Fila do cadastro online. O cliente envia por link do vendedor; alguem aprova antes de virar linha em clientes. anon NAO escreve aqui: a rota usa service_role.';

-- ------------------------------------------------------------------
-- 4. RLS
--    anon: NENHUMA policy, nenhum grant. service_role tem rolbypassrls.
--    authenticated: le e atualiza (a tela de aprovacao e a Etapa 2).
-- ------------------------------------------------------------------
alter table public.cadastro_links    enable row level security;
alter table public.cadastros_online  enable row level security;

-- cadastro_links: RLS ligada SEM policy, de proposito — igual a os_qr_tokens.
-- Nem leitura ampla nem escrita direta. Tudo passa pelas funcoes.

create policy "cadastros_online_select_authenticated"
  on public.cadastros_online for select to authenticated
  using (true);

create policy "cadastros_online_update_authenticated"
  on public.cadastros_online for update to authenticated
  using (true) with check (true);

-- ------------------------------------------------------------------
-- 5. GRANTS — explicitos, porque o default privilege deste banco ainda
--    concede PUBLIC em funcao nova (ver 20260901154326).
-- ------------------------------------------------------------------
revoke all on table public.cadastro_links   from public, anon;
revoke all on table public.cadastros_online from public, anon;

-- O default privilege deste banco concede a `authenticated` em TODA tabela nova.
-- cadastro_links guarda hash de token: nem quem aprova cadastro precisa ver.
-- Sem esta linha a assercao de saida 7.2 aborta, como abortou em 07/09.
revoke all on table public.cadastro_links   from authenticated;

grant select, update on table public.cadastros_online to authenticated;
grant all on table public.cadastro_links   to service_role;
grant all on table public.cadastros_online to service_role;

-- ------------------------------------------------------------------
-- 6. FUNCOES — EXECUTE so para service_role
-- ------------------------------------------------------------------

-- 6.1 Resolve o token e diz de quem e o link. Confere os CINCO sinais de saida
--     do vendedor NO MOMENTO DO USO. Aplica o rate limit persistente.
create or replace function public.cadastro_link_resolver(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash      text;
  v_link      record;
  v_usuario   record;
  v_janela    constant interval := interval '1 hour';
  v_teto      constant integer  := 20;
begin
  -- forma antes de tocar no banco
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_link from public.cadastro_links where token_hash = v_hash limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  -- trava a linha: serializa o rate limit e re-checa a revogacao pos-lock
  select * into v_link from public.cadastro_links where id = v_link.id for update;
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
  end if;

  -- rate limit por token, janela fixa
  if v_link.rl_janela_inicio is null or now() - v_link.rl_janela_inicio > v_janela then
    update public.cadastro_links
       set rl_janela_inicio = now(), rl_tentativas = 1
     where id = v_link.id;
  else
    if v_link.rl_tentativas >= v_teto then
      -- mesma mensagem do token invalido: nao se informa que ha limite
      return jsonb_build_object('ok', false, 'motivo', 'TOKEN_INVALIDO');
    end if;
    update public.cadastro_links
       set rl_tentativas = v_link.rl_tentativas + 1
     where id = v_link.id;
  end if;

  -- OS CINCO SINAIS de que o vendedor saiu, conferidos AGORA
  select u.user_id, u.nome_usuario, u.meu_vendedor, u.is_vendedor, u.id_perfil,
         p.slug as perfil_slug, a.banned_until, a.deleted_at
    into v_usuario
    from public.usuarios u
    left join public.perfis p on p.id = u.id_perfil
    left join auth.users  a on a.id = u.user_id
   where u.id_vendedor = v_link.id_vendedor
   limit 1;

  if not found                                            -- 1. sumiu de usuarios
     or coalesce(v_usuario.is_vendedor, false) is not true -- 2. deixou de ser vendedor
     or v_usuario.perfil_slug = 'pendente_aprovacao'       -- 3. perfil rebaixado
     or (v_usuario.banned_until is not null and v_usuario.banned_until > now())  -- 4. banido
     or v_usuario.deleted_at is not null                   -- 5. excluido
  then
    return jsonb_build_object('ok', false, 'motivo', 'VENDEDOR_INDISPONIVEL');
  end if;

  -- so o PRIMEIRO NOME sai daqui. Nunca id, e-mail ou documento do vendedor.
  return jsonb_build_object(
    'ok', true,
    'id_link', v_link.id,
    'id_vendedor', v_link.id_vendedor,
    'primeiro_nome', split_part(btrim(coalesce(v_usuario.meu_vendedor, v_usuario.nome_usuario, '')), ' ', 1)
  );
end;
$$;

-- 6.2 Grava um envio na fila. Recebe ja validado pela rota (digito verificador,
--     honeypot, rate limit por IP) e resolve o token de novo aqui dentro — a
--     rota nao e a fonte da verdade sobre de quem e o link.
create or replace function public.cadastro_online_registrar(
  p_token               text,
  p_documento           text,
  p_tipo_pessoa         text,
  p_nome                text,
  p_fantasia            text,
  p_email               text,
  p_whatsapp            text,
  p_telefone_fixo       text,
  p_cep                 text,
  p_endereco            text,
  p_numero              text,
  p_complemento         text,
  p_bairro              text,
  p_cidade              text,
  p_uf                  text,
  p_consentimento_texto  text,
  p_consentimento_versao text,
  p_ip_hash             text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_link jsonb;
  v_id   uuid;
begin
  v_link := public.cadastro_link_resolver(p_token);
  if (v_link->>'ok')::boolean is not true then
    return v_link;   -- mensagem neutra, ja montada pelo resolver
  end if;

  if coalesce(btrim(p_documento), '') = '' or coalesce(btrim(p_nome), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'DADOS_INCOMPLETOS');
  end if;

  if coalesce(btrim(p_consentimento_texto), '') = ''
     or coalesce(btrim(p_consentimento_versao), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'CONSENTIMENTO_AUSENTE');
  end if;

  insert into public.cadastros_online (
    id_vendedor, nome_vendedor, id_link,
    documento, tipo_pessoa, nome, fantasia, email, whatsapp, telefone_fixo,
    cep, endereco, numero, complemento, bairro, cidade, uf,
    consentimento_em, consentimento_texto, consentimento_versao, ip_hash
  ) values (
    (v_link->>'id_vendedor')::uuid, v_link->>'primeiro_nome', (v_link->>'id_link')::bigint,
    btrim(p_documento), p_tipo_pessoa, btrim(p_nome), p_fantasia, p_email, p_whatsapp, p_telefone_fixo,
    p_cep, p_endereco, p_numero, p_complemento, p_bairro, p_cidade, upper(nullif(btrim(p_uf), '')),
    now(), p_consentimento_texto, p_consentimento_versao, p_ip_hash
  ) returning id into v_id;

  update public.cadastro_links
     set uso_count = uso_count + 1, last_used_at = now()
   where id = (v_link->>'id_link')::bigint;

  -- resposta SEMPRE igual, exista o cliente ou nao: o endpoint nao pode virar
  -- oraculo de "esse CNPJ ja e cliente da Ideal".
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Fecha na mao. `from public, anon` explicito: REVOKE FROM PUBLIC nao alcanca
-- grant nominal ao anon, e neste banco funcao nova ainda nasce com PUBLIC.
revoke all on function public.cadastro_link_resolver(text) from public, anon, authenticated;
revoke all on function public.cadastro_online_registrar(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;

grant execute on function public.cadastro_link_resolver(text) to service_role;
grant execute on function public.cadastro_online_registrar(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) to service_role;

-- ------------------------------------------------------------------
-- 7. ASSERCOES DE SAIDA
-- ------------------------------------------------------------------
do $saida$
declare
  v_grantees text[];
  v_n integer;
begin
  -- 7.1 as duas tabelas existem e o anon nao alcanca nenhuma
  if to_regclass('public.cadastro_links') is null or to_regclass('public.cadastros_online') is null then
    raise exception 'ABORTADO: alguma das tabelas nao foi criada.';
  end if;

  if has_table_privilege('anon','public.cadastro_links','SELECT')
     or has_table_privilege('anon','public.cadastro_links','INSERT')
     or has_table_privilege('anon','public.cadastros_online','SELECT')
     or has_table_privilege('anon','public.cadastros_online','INSERT')
     or has_table_privilege('anon','public.cadastros_online','UPDATE')
     or has_table_privilege('anon','public.cadastros_online','DELETE')
  then
    raise exception 'ABORTADO: anon alcanca cadastro_links e/ou cadastros_online.';
  end if;

  -- 7.2 authenticated le e atualiza a fila, e NAO alcanca os tokens
  if not (has_table_privilege('authenticated','public.cadastros_online','SELECT')
      and has_table_privilege('authenticated','public.cadastros_online','UPDATE')) then
    raise exception 'ABORTADO: authenticated nao consegue ler/atualizar a fila — a tela de aprovacao nao funcionaria.';
  end if;

  if has_table_privilege('authenticated','public.cadastro_links','SELECT') then
    raise exception 'ABORTADO: authenticated alcanca cadastro_links. So service_role deve alcancar.';
  end if;

  -- 7.3 ACL COMPLETO das duas funcoes, com aclexplode em LATERAL.
  --     aclexplode e set-returning: dentro de array_agg da erro 0A000.
  --     Esperado: {service_role} e mais nada — sem "-" (PUBLIC), sem anon.
  select array_agg(distinct acl.grantee::regrole::text order by acl.grantee::regrole::text)
    into v_grantees
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) acl
   where n.nspname = 'public' and p.proname = 'cadastro_link_resolver'
     and acl.privilege_type = 'EXECUTE';

  if v_grantees is distinct from array['postgres','service_role'] then
    raise exception 'ABORTADO: ACL de cadastro_link_resolver e %, esperado {postgres,service_role}.', v_grantees;
  end if;

  select array_agg(distinct acl.grantee::regrole::text order by acl.grantee::regrole::text)
    into v_grantees
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) acl
   where n.nspname = 'public' and p.proname = 'cadastro_online_registrar'
     and acl.privilege_type = 'EXECUTE';

  if v_grantees is distinct from array['postgres','service_role'] then
    raise exception 'ABORTADO: ACL de cadastro_online_registrar e %, esperado {postgres,service_role}.', v_grantees;
  end if;

  -- 7.4 COMPORTAMENTO: o anon nao pode nem executar as funcoes.
  --     `SET LOCAL ROLE` dentro de bloco com EXCEPTION: o rollback da
  --     subtransacao devolve o papel, sem RESET ROLE — que o anon nao poderia.
  begin
    set local role anon;
    perform public.cadastro_link_resolver('x');
    raise exception using errcode = 'AN001', message = 'anon executou';
  exception
    when insufficient_privilege then null;                        -- correto
    when sqlstate 'AN001' then
      raise exception 'ABORTADO: anon conseguiu executar cadastro_link_resolver.';
  end;

  -- 7.5 RLS ligada nas duas, e cadastro_links sem policy nenhuma
  if not (select relrowsecurity from pg_class where oid = 'public.cadastro_links'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.cadastros_online'::regclass) then
    raise exception 'ABORTADO: RLS nao ficou ligada nas duas tabelas.';
  end if;

  select count(*) into v_n from pg_policy where polrelid = 'public.cadastro_links'::regclass;
  if v_n <> 0 then
    raise exception 'ABORTADO: cadastro_links tem % policy(s); deve ter ZERO, como os_qr_tokens.', v_n;
  end if;

  -- 7.6 as duas tabelas nascem vazias
  if (select count(*) from public.cadastros_online) <> 0
     or (select count(*) from public.cadastro_links) <> 0 then
    raise exception 'ABORTADO: as tabelas deveriam nascer vazias.';
  end if;

  raise notice 'Saida OK: anon sem acesso a tabela e sem EXECUTE (medido por SET LOCAL ROLE); ACL das 2 funcoes = {service_role}; RLS ligada; cadastro_links sem policy; tabelas vazias.';
end
$saida$;


-- =====================================================================
-- VERIFICACOES APOS APLICAR (rodar como SELECT)
-- =====================================================================
--
-- (a) ACL das duas funcoes:
--     select p.proname,
--            array_agg(acl.grantee::regrole::text order by acl.grantee::regrole::text) as grantees
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       cross join lateral aclexplode(p.proacl) acl
--      where n.nspname='public' and acl.privilege_type='EXECUTE'
--        and p.proname in ('cadastro_link_resolver','cadastro_online_registrar')
--      group by p.proname;
--     -- esperado: {service_role} nas duas. Sem "-" e sem anon.
--
-- (b) ACL das duas tabelas:
--     select c.relname, c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
--      where n.nspname='public' and c.relname in ('cadastro_links','cadastros_online');
--     -- esperado: cadastro_links so postgres e service_role;
--     --           cadastros_online mais authenticated com r/w
--
-- (c) pelo PostgREST, com a anon key: as duas tabelas e as duas RPCs -> 401.
--
-- (d) a contagem de views/funcoes alcancaveis pelo anon NAO pode ter mudado:
--     views 5, funcoes SECURITY DEFINER 36 (o numero de 07/09/2026).
--
--
-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Nada depende destes objetos ate a Etapa 2. Derrubar nao afeta linha, FK ou
-- fluxo algum. A ordem importa: as funcoes primeiro, depois a fila (que tem FK
-- para os links), depois os links.
--
-- begin;
--   drop function if exists public.cadastro_online_registrar(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text);
--   drop function if exists public.cadastro_link_resolver(text);
--   drop table if exists public.cadastros_online;
--   drop table if exists public.cadastro_links;
-- commit;
--
-- Se ja houver envio na fila, `drop table` PERDE os envios. Nesse caso, exportar
-- antes:
--   copy (select * from public.cadastros_online) to stdout with csv header;
-- =====================================================================
