-- =====================================================================
-- Trava compartilhada ChatGuru (Vibe + Imposition) - revisão 4
--
-- NÃO APLICADA. Fica fora de supabase/migrations de propósito.
-- Aplicar inteira, numa transação, só com autorização nominal, na ordem da
-- seção "Transição" de docs/technical/CHATGURU-TRAVA-COMPARTILHADA-PROPOSTA.md.
-- Teste com ROLLBACK pronto em CHATGURU-TRAVA-COMPARTILHADA-TESTE.sql (ainda nao rodado).
--
-- Partes:
--   1. margem configurável (chatguru_trava_config, padrão 10 s)
--   2. registro para conferir a margem (chatguru_trava_registro + visão)
--   3. imposition_whatsapp_conversas: sai a chave estrangeira, entra check e livre_em
--   4. gatilhos de integridade (dono existe, com bloqueio de linha; dono não se apaga)
--   5. funções novas do Vibe: imposition_whatsapp_conversa_travar / _soltar
--   6. as três RPCs do Imposition respeitando livre_em: reservar, reenviar, finalizar
--   7. passagem: avisos do Vibe pendentes ocupam a conversa
--   Rodapé: reversão
-- =====================================================================

-- 1) Margem configurável -------------------------------------------------
create table public.chatguru_trava_config (
  id boolean primary key default true check (id),
  margem interval not null default interval '10 seconds'
    check (margem >= interval '0' and margem <= interval '2 minutes'),
  janela_conferencia interval not null default interval '30 seconds'
    check (janela_conferencia > interval '0' and janela_conferencia <= interval '10 minutes'),
  atualizado_em timestamptz not null default now()
);
insert into public.chatguru_trava_config default values;

create function public.chatguru_trava_margem()
returns interval language sql stable set search_path to '' as $$
  select coalesce((select margem from public.chatguru_trava_config where id), interval '10 seconds')
$$;

-- 2) Registro para conferir depois ---------------------------------------
-- 'reservado' = a conversa foi ocupada e os campos vão ser gravados em seguida;
-- 'executado' = o ChatGuru respondeu "Diálogo Executado" e a margem começou;
-- 'solto'     = soltura sem diálogo executado (falha, ou Liberar número).
create table public.chatguru_trava_registro (
  id bigint generated always as identity primary key,
  destino_chave text not null check (destino_chave ~ '^[a-f0-9]{64}$'),
  origem text not null check (origem in ('vibe', 'imposition')),
  chave text not null,
  evento text not null check (evento in ('reservado', 'executado', 'solto')),
  em timestamptz not null default clock_timestamp()
);
create index chatguru_trava_registro_destino_em on public.chatguru_trava_registro (destino_chave, em);

-- Aviso executado em que outro envio ocupou a mesma conversa (e gravou campos)
-- dentro da janela de conferência (30 s). Linha aqui = a margem pode ter sido curta.
create view public.chatguru_trava_conferencia with (security_invoker = true) as
select e.destino_chave, e.origem, e.chave, e.em as executado_em,
       o.origem as outro_origem, o.chave as outro_chave, o.em as outro_reservado_em,
       round(extract(epoch from o.em - e.em)::numeric, 1) as segundos_depois
  from public.chatguru_trava_registro e
  join public.chatguru_trava_registro o
    on o.destino_chave = e.destino_chave
   and o.evento = 'reservado'
   and o.chave <> e.chave
   and o.em > e.em
   and o.em <= e.em + (select c.janela_conferencia from public.chatguru_trava_config c where c.id)
 where e.evento = 'executado';

alter table public.chatguru_trava_config enable row level security;
alter table public.chatguru_trava_registro enable row level security;
revoke all on public.chatguru_trava_config from public, anon, authenticated;
revoke all on public.chatguru_trava_registro from public, anon, authenticated;
revoke all on public.chatguru_trava_conferencia from public, anon, authenticated;
revoke all on function public.chatguru_trava_margem() from public, anon, authenticated;
grant execute on function public.chatguru_trava_margem() to service_role;

-- 3) Conversas: sem chave estrangeira; formato conferido; livre_em ---------
alter table public.imposition_whatsapp_conversas
  drop constraint imposition_whatsapp_conversas_chave_envio_fkey;
alter table public.imposition_whatsapp_conversas
  add constraint imposition_whatsapp_conversas_chave_envio_check
  check (chave_envio is null
         or chave_envio ~ '^[a-f0-9]{64}$'
         or chave_envio ~ '^vibe:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
alter table public.imposition_whatsapp_conversas add column livre_em timestamptz;
create index imposition_whatsapp_conversas_chave_envio
  on public.imposition_whatsapp_conversas (chave_envio) where chave_envio is not null;

-- 4) Integridade ---------------------------------------------------------
-- 4a) O dono da trava existe. FOR KEY SHARE prende a linha do dono até o fim
--     da transação: um DELETE (ou troca da chave) concorrente espera, e depois
--     o gatilho 4b dele já enxerga a trava gravada e recusa. Se o DELETE vier
--     primeiro, este SELECT espera o commit dele e não acha mais a linha.
create function public.imposition_whatsapp_conversas_dono_existe()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.chave_envio is null then return new; end if;
  if tg_op = 'UPDATE' and new.chave_envio is not distinct from old.chave_envio then return new; end if;
  if new.chave_envio like 'vibe:%' then
    perform 1 from public.expedicao_aviso_pronto
      where id = substr(new.chave_envio, 6)::uuid for key share;
    if not found then
      raise exception 'Trava sem aviso do Vibe: %', new.chave_envio using errcode = '23503';
    end if;
  else
    perform 1 from public.imposition_whatsapp_artes
      where chave = new.chave_envio for key share;
    if not found then
      raise exception 'Trava sem envio de arte: %', new.chave_envio using errcode = '23503';
    end if;
  end if;
  return new;
end $$;
create trigger imposition_whatsapp_conversas_dono
  before insert or update of chave_envio on public.imposition_whatsapp_conversas
  for each row execute function public.imposition_whatsapp_conversas_dono_existe();

-- 4b) Não apagar (nem trocar a chave de) quem segura uma conversa.
--     Correção da revisão 3: lá, um CASE só citava old.id e old.chave na mesma
--     expressão; o PL/pgSQL resolve os dois campos ao preparar a expressão, então
--     todo DELETE nas duas tabelas falhava com 'record "old" has no field ...',
--     segurando ou não a conversa. Aqui cada tabela tem o seu ramo.
create function public.imposition_whatsapp_trava_nao_apagar()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_chave text;
begin
  if current_setting('transaction_isolation') = 'repeatable read' then
    -- Num snapshot antigo a trava recém-gravada por outra transação não aparece.
    raise exception 'Apague ou troque a chave em READ COMMITTED (ou SERIALIZABLE)';
  end if;
  if tg_table_name = 'expedicao_aviso_pronto' then
    if tg_op = 'UPDATE' and new.id = old.id then return new; end if;
    v_chave := 'vibe:' || old.id::text;
  else
    if tg_op = 'UPDATE' and new.chave = old.chave then return new; end if;
    v_chave := old.chave;
  end if;
  if exists (select 1 from public.imposition_whatsapp_conversas where chave_envio = v_chave) then
    raise exception 'Registro % segura a conversa: libere a trava antes de apagar', v_chave
      using errcode = '23503';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger expedicao_aviso_pronto_trava_nao_apagar
  before delete or update of id on public.expedicao_aviso_pronto
  for each row execute function public.imposition_whatsapp_trava_nao_apagar();
create trigger imposition_whatsapp_artes_trava_nao_apagar
  before delete or update of chave on public.imposition_whatsapp_artes
  for each row execute function public.imposition_whatsapp_trava_nao_apagar();

revoke all on function public.imposition_whatsapp_conversas_dono_existe() from public, anon, authenticated;
revoke all on function public.imposition_whatsapp_trava_nao_apagar() from public, anon, authenticated;

-- 5) Funções novas do Vibe -----------------------------------------------
-- 5a) Ocupar a conversa para um aviso do Vibe.
create function public.imposition_whatsapp_conversa_travar(p_destino text, p_chave text)
returns text language plpgsql set search_path to '' as $$
declare v record;
begin
  if p_destino is null or p_chave is null then raise exception 'Parametro nulo'; end if;
  if p_destino !~ '^[a-f0-9]{64}$'
     or p_chave !~ '^vibe:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Parametro invalido';
  end if;
  insert into public.imposition_whatsapp_conversas(destino_chave) values (p_destino) on conflict do nothing;
  select chave_envio, livre_em into v
    from public.imposition_whatsapp_conversas where destino_chave = p_destino for update;
  if v.chave_envio is not null or v.livre_em > clock_timestamp() then return 'ocupado'; end if;
  update public.imposition_whatsapp_conversas
     set chave_envio = p_chave, livre_em = null, atualizado_em = now()
   where destino_chave = p_destino;
  insert into public.chatguru_trava_registro(destino_chave, origem, chave, evento)
    values (p_destino, 'vibe', p_chave, 'reservado');
  return 'reservado';
end $$;

-- 5b) Soltar, só se a conversa ainda é deste aviso. Com diálogo executado,
--     a conversa fica presa pela margem configurada (livre_em).
create function public.imposition_whatsapp_conversa_soltar(p_destino text, p_chave text, p_executado boolean)
returns boolean language plpgsql set search_path to '' as $$
begin
  if p_destino is null or p_chave is null or p_executado is null then raise exception 'Parametro nulo'; end if;
  update public.imposition_whatsapp_conversas
     set chave_envio = null,
         livre_em = case when p_executado then clock_timestamp() + public.chatguru_trava_margem() end,
         atualizado_em = now()
   where destino_chave = p_destino and chave_envio = p_chave;
  if not found then return false; end if;
  insert into public.chatguru_trava_registro(destino_chave, origem, chave, evento)
    values (p_destino, 'vibe', p_chave, case when p_executado then 'executado' else 'solto' end);
  return true;
end $$;

revoke all on function public.imposition_whatsapp_conversa_travar(text, text) from public, anon, authenticated;
revoke all on function public.imposition_whatsapp_conversa_soltar(text, text, boolean) from public, anon, authenticated;
grant execute on function public.imposition_whatsapp_conversa_travar(text, text) to service_role;
grant execute on function public.imposition_whatsapp_conversa_soltar(text, text, boolean) to service_role;

-- 6) RPCs do Imposition respeitando livre_em -------------------------------
-- Mesmas assinaturas e mesmo retorno: CREATE OR REPLACE mantém as permissões
-- (só service_role). Mudanças marcadas com "rev4".
CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_reservar(p_chave text, p_destino text, p_os_id text, p_autor uuid, p_dialogo text, p_repetir boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE ocupado text; v_livre timestamptz; atual public.imposition_whatsapp_artes;
BEGIN
 INSERT INTO public.imposition_whatsapp_conversas(destino_chave) VALUES(p_destino) ON CONFLICT DO NOTHING;
 SELECT chave_envio, livre_em INTO ocupado, v_livre FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE; -- rev4: livre_em
 IF ocupado IS NOT NULL OR v_livre > clock_timestamp() THEN RETURN 'ocupado'; END IF; -- rev4: margem
 SELECT * INTO atual FROM public.imposition_whatsapp_artes WHERE chave=p_chave FOR UPDATE;
 IF FOUND THEN
   IF NOT p_repetir OR atual.estado<>'falhou' OR atual.message_id IS NOT NULL OR atual.dialogo_executado OR atual.os_id<>p_os_id THEN RETURN 'existente'; END IF;
   UPDATE public.imposition_whatsapp_artes SET estado='preparando', autor=p_autor,
     dialogo_id=p_dialogo, atualizado_em=now(), tentativas=tentativas+1 WHERE chave=p_chave;
 ELSE
   INSERT INTO public.imposition_whatsapp_artes(chave,os_id,autor,dialogo_id) VALUES(p_chave,p_os_id,p_autor,p_dialogo)
     ON CONFLICT DO NOTHING;
   IF NOT FOUND THEN RETURN 'existente'; END IF;
 END IF;
 UPDATE public.imposition_whatsapp_conversas SET chave_envio=p_chave, livre_em=NULL, atualizado_em=now() WHERE destino_chave=p_destino; -- rev4: livre_em
 INSERT INTO public.chatguru_trava_registro(destino_chave, origem, chave, evento) VALUES (p_destino, 'imposition', p_chave, 'reservado'); -- rev4
 RETURN 'reservado';
END;
$function$;

CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_reenviar(p_chave text, p_destino text, p_os_id text, p_autor uuid, p_dialogo text, p_atualizado_em timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE ocupado text; v_livre timestamptz; atual public.imposition_whatsapp_artes;
BEGIN
 INSERT INTO public.imposition_whatsapp_conversas(destino_chave) VALUES(p_destino) ON CONFLICT DO NOTHING;
 SELECT chave_envio, livre_em INTO ocupado, v_livre FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE; -- rev4: livre_em
 IF ocupado IS NOT NULL OR v_livre > clock_timestamp() THEN RETURN 'ocupado'; END IF; -- rev4: margem
 SELECT * INTO atual FROM public.imposition_whatsapp_artes WHERE chave=p_chave FOR UPDATE;
 IF NOT FOUND THEN RETURN 'existente'; END IF;
 IF atual.os_id<>p_os_id OR atual.estado NOT IN ('aguardando','enviado')
    OR (atual.message_id IS NULL AND NOT atual.dialogo_executado)
    OR atual.atualizado_em IS DISTINCT FROM p_atualizado_em
    OR clock_timestamp()<atual.atualizado_em+interval '120 seconds' THEN RETURN 'existente'; END IF;
 INSERT INTO public.imposition_whatsapp_reenvios(chave,registro_anterior) VALUES(p_chave,to_jsonb(atual));
 UPDATE public.imposition_whatsapp_artes SET estado='preparando',autor=p_autor,
   dialogo_id=p_dialogo,dialogo_executado=false,message_id=NULL,concluido=false,
   atualizado_em=clock_timestamp(),tentativas=tentativas+1 WHERE chave=p_chave;
 UPDATE public.imposition_whatsapp_conversas SET chave_envio=p_chave,livre_em=NULL,atualizado_em=clock_timestamp() WHERE destino_chave=p_destino; -- rev4: livre_em
 INSERT INTO public.chatguru_trava_registro(destino_chave, origem, chave, evento) VALUES (p_destino, 'imposition', p_chave, 'reservado'); -- rev4
 RETURN 'reservado';
END;
$function$;

CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_finalizar(p_chave text, p_destino text, p_estado text)
 RETURNS SETOF public.imposition_whatsapp_artes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE ocupado text;
BEGIN
 IF p_estado NOT IN ('aguardando','falhou','desconhecido') THEN RAISE EXCEPTION 'Estado invalido'; END IF;
 SELECT chave_envio INTO ocupado FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
 IF ocupado IS DISTINCT FROM p_chave THEN RAISE EXCEPTION 'Reserva da conversa nao confirmada'; END IF;
 RETURN QUERY UPDATE public.imposition_whatsapp_artes SET estado=p_estado,
   dialogo_executado=(p_estado='aguardando'), atualizado_em=now()
   WHERE chave=p_chave AND estado='preparando' AND message_id IS NULL AND dialogo_id IS NOT NULL RETURNING *;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registro do dialogo nao confirmado'; END IF;
 -- Incerteza não libera a conversa: confirmar no CRM antes de reconciliar.
 IF p_estado<>'desconhecido' THEN
   UPDATE public.imposition_whatsapp_conversas SET chave_envio=NULL,
     livre_em = CASE WHEN p_estado='aguardando' THEN clock_timestamp() + public.chatguru_trava_margem() END, -- rev4: margem
     atualizado_em=now() WHERE destino_chave=p_destino;
   INSERT INTO public.chatguru_trava_registro(destino_chave, origem, chave, evento)
     VALUES (p_destino, 'imposition', p_chave, CASE WHEN p_estado='aguardando' THEN 'executado' ELSE 'solto' END); -- rev4
 END IF;
END;
$function$;

-- 7) Passagem: aviso do Vibe em 'desconhecido', ou em 'preparando' há mais de
--    2 minutos, ocupa a conversa. Conversa já ocupada não é sobrescrita; a
--    consulta do fim lista esses casos para conferência manual.
--    (09/11/2026: zero avisos do Vibe nesses estados.)
insert into public.imposition_whatsapp_conversas(destino_chave)
  select distinct destino_chave from public.expedicao_aviso_pronto
   where destino_chave is not null
     and (estado = 'desconhecido' or (estado = 'preparando' and atualizado_em < now() - interval '2 minutes'))
  on conflict do nothing;
update public.imposition_whatsapp_conversas c
   set chave_envio = 'vibe:' || a.id::text, atualizado_em = now()
  from public.expedicao_aviso_pronto a
 where a.destino_chave = c.destino_chave and c.chave_envio is null
   and (a.estado = 'desconhecido' or (a.estado = 'preparando' and a.atualizado_em < now() - interval '2 minutes'));
-- Conferência manual (rodar depois, só leitura):
--   select a.id, a.id_int, a.estado, c.chave_envio from public.expedicao_aviso_pronto a
--     join public.imposition_whatsapp_conversas c on c.destino_chave = a.destino_chave
--    where (a.estado = 'desconhecido' or (a.estado = 'preparando' and a.atualizado_em < now() - interval '2 minutes'))
--      and c.chave_envio is distinct from 'vibe:' || a.id::text;

-- =====================================================================
-- REVERSÃO (rodapé). Antes: o Vibe volta para a versão sem trava compartilhada
-- (a v19 recusa todo envio sem a função travar, então fica parada, sem risco).
-- O Imposition não precisa voltar código: as RPCs voltam ao texto de antes.
-- =====================================================================
-- begin;
-- -- solta as travas do Vibe (a chave estrangeira volta e não aceita 'vibe:')
-- update public.imposition_whatsapp_conversas set chave_envio = null, atualizado_em = now()
--  where chave_envio like 'vibe:%';
-- drop trigger imposition_whatsapp_conversas_dono on public.imposition_whatsapp_conversas;
-- drop trigger expedicao_aviso_pronto_trava_nao_apagar on public.expedicao_aviso_pronto;
-- drop trigger imposition_whatsapp_artes_trava_nao_apagar on public.imposition_whatsapp_artes;
-- drop function public.imposition_whatsapp_conversas_dono_existe();
-- drop function public.imposition_whatsapp_trava_nao_apagar();
-- drop function public.imposition_whatsapp_conversa_travar(text, text);
-- drop function public.imposition_whatsapp_conversa_soltar(text, text, boolean);
--
-- CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_reservar(p_chave text, p_destino text, p_os_id text, p_autor uuid, p_dialogo text, p_repetir boolean DEFAULT false)
--  RETURNS text LANGUAGE plpgsql SET search_path TO ''
-- AS $function$
-- DECLARE ocupado text; atual public.imposition_whatsapp_artes;
-- BEGIN
--  INSERT INTO public.imposition_whatsapp_conversas(destino_chave) VALUES(p_destino) ON CONFLICT DO NOTHING;
--  SELECT chave_envio INTO ocupado FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
--  IF ocupado IS NOT NULL THEN RETURN 'ocupado'; END IF;
--  SELECT * INTO atual FROM public.imposition_whatsapp_artes WHERE chave=p_chave FOR UPDATE;
--  IF FOUND THEN
--    IF NOT p_repetir OR atual.estado<>'falhou' OR atual.message_id IS NOT NULL OR atual.dialogo_executado OR atual.os_id<>p_os_id THEN RETURN 'existente'; END IF;
--    UPDATE public.imposition_whatsapp_artes SET estado='preparando', autor=p_autor,
--      dialogo_id=p_dialogo, atualizado_em=now(), tentativas=tentativas+1 WHERE chave=p_chave;
--  ELSE
--    INSERT INTO public.imposition_whatsapp_artes(chave,os_id,autor,dialogo_id) VALUES(p_chave,p_os_id,p_autor,p_dialogo)
--      ON CONFLICT DO NOTHING;
--    IF NOT FOUND THEN RETURN 'existente'; END IF;
--  END IF;
--  UPDATE public.imposition_whatsapp_conversas SET chave_envio=p_chave, atualizado_em=now() WHERE destino_chave=p_destino;
--  RETURN 'reservado';
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_reenviar(p_chave text, p_destino text, p_os_id text, p_autor uuid, p_dialogo text, p_atualizado_em timestamp with time zone)
--  RETURNS text LANGUAGE plpgsql SET search_path TO ''
-- AS $function$
-- DECLARE ocupado text; atual public.imposition_whatsapp_artes;
-- BEGIN
--  INSERT INTO public.imposition_whatsapp_conversas(destino_chave) VALUES(p_destino) ON CONFLICT DO NOTHING;
--  SELECT chave_envio INTO ocupado FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
--  IF ocupado IS NOT NULL THEN RETURN 'ocupado'; END IF;
--  SELECT * INTO atual FROM public.imposition_whatsapp_artes WHERE chave=p_chave FOR UPDATE;
--  IF NOT FOUND THEN RETURN 'existente'; END IF;
--  IF atual.os_id<>p_os_id OR atual.estado NOT IN ('aguardando','enviado')
--     OR (atual.message_id IS NULL AND NOT atual.dialogo_executado)
--     OR atual.atualizado_em IS DISTINCT FROM p_atualizado_em
--     OR clock_timestamp()<atual.atualizado_em+interval '120 seconds' THEN RETURN 'existente'; END IF;
--  INSERT INTO public.imposition_whatsapp_reenvios(chave,registro_anterior) VALUES(p_chave,to_jsonb(atual));
--  UPDATE public.imposition_whatsapp_artes SET estado='preparando',autor=p_autor,
--    dialogo_id=p_dialogo,dialogo_executado=false,message_id=NULL,concluido=false,
--    atualizado_em=clock_timestamp(),tentativas=tentativas+1 WHERE chave=p_chave;
--  UPDATE public.imposition_whatsapp_conversas SET chave_envio=p_chave,atualizado_em=clock_timestamp() WHERE destino_chave=p_destino;
--  RETURN 'reservado';
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_finalizar(p_chave text, p_destino text, p_estado text)
--  RETURNS SETOF public.imposition_whatsapp_artes LANGUAGE plpgsql SET search_path TO ''
-- AS $function$
-- DECLARE ocupado text;
-- BEGIN
--  IF p_estado NOT IN ('aguardando','falhou','desconhecido') THEN RAISE EXCEPTION 'Estado invalido'; END IF;
--  SELECT chave_envio INTO ocupado FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
--  IF ocupado IS DISTINCT FROM p_chave THEN RAISE EXCEPTION 'Reserva da conversa nao confirmada'; END IF;
--  RETURN QUERY UPDATE public.imposition_whatsapp_artes SET estado=p_estado,
--    dialogo_executado=(p_estado='aguardando'), atualizado_em=now()
--    WHERE chave=p_chave AND estado='preparando' AND message_id IS NULL AND dialogo_id IS NOT NULL RETURNING *;
--  IF NOT FOUND THEN RAISE EXCEPTION 'Registro do dialogo nao confirmado'; END IF;
--  -- Incerteza não libera a conversa: confirmar no CRM antes de reconciliar.
--  IF p_estado<>'desconhecido' THEN
--    UPDATE public.imposition_whatsapp_conversas SET chave_envio=NULL, atualizado_em=now() WHERE destino_chave=p_destino;
--  END IF;
-- END;
-- $function$;
--
-- drop index public.imposition_whatsapp_conversas_chave_envio;
-- alter table public.imposition_whatsapp_conversas drop column livre_em;
-- alter table public.imposition_whatsapp_conversas drop constraint imposition_whatsapp_conversas_chave_envio_check;
-- alter table public.imposition_whatsapp_conversas
--   add constraint imposition_whatsapp_conversas_chave_envio_fkey
--   foreign key (chave_envio) references public.imposition_whatsapp_artes(chave);
-- drop view public.chatguru_trava_conferencia;
-- drop function public.chatguru_trava_margem();
-- drop table public.chatguru_trava_registro;   -- guardar uma cópia antes, se já tiver linhas
-- drop table public.chatguru_trava_config;
-- commit;
