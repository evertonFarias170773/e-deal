-- Teste da migracao da trava compartilhada (revisao 4).
-- Roda tudo numa transacao e termina em ROLLBACK: nada fica no banco.
-- Primeiro reproduz o erro do gatilho da revisao 3 (casos R3), depois aplica a
-- revisao 4 e roda os casos dos itens 1 e 2 e uma reserva/soltura de cada lado.
-- Resultado: uma linha por caso, com PASSA ou FALHA.
-- Segura bloqueio nas tabelas imposition_whatsapp_conversas, imposition_whatsapp_artes
-- e expedicao_aviso_pronto por cerca de 1 segundo.

begin;
create temp table _r(n serial, caso text, esperado text, obtido text);
create function pg_temp.tenta(p text) returns text language plpgsql as $f$
declare r text;
begin execute p into r; return 'ok:' || coalesce(r, ''); exception when others then return 'erro:' || sqlerrm; end $f$;
create function pg_temp.reg(c text, e text, o text) returns void language sql as $f$ insert into _r(caso, esperado, obtido) values (c, e, o) $f$;

insert into public.expedicao_aviso_pronto(id, id_int, seq, modo_teste, autor, estado) values
 ('00000000-0000-4000-8000-0000000000a1', 999999, 1, true, '00000000-0000-4000-8000-000000000007', 'executado'),
 ('00000000-0000-4000-8000-0000000000a2', 999999, 2, true, '00000000-0000-4000-8000-000000000007', 'executado'),
 ('00000000-0000-4000-8000-0000000000a3', 999999, 3, true, '00000000-0000-4000-8000-000000000007', 'executado'),
 ('00000000-0000-4000-8000-0000000000a4', 999999, 4, true, '00000000-0000-4000-8000-000000000007', 'executado');
insert into public.imposition_whatsapp_artes(chave, os_id, autor, estado) values
 (repeat('a', 64), 'vibe_999999', '00000000-0000-4000-8000-000000000007', 'aguardando'),
 (repeat('b', 64), 'vibe_999999', '00000000-0000-4000-8000-000000000007', 'aguardando');
insert into public.imposition_whatsapp_conversas(destino_chave, chave_envio) values (repeat('2', 64), repeat('b', 64));

create function public.imposition_whatsapp_trava_nao_apagar()
returns trigger language plpgsql set search_path to '' as $f$
declare v_chave text := case when tg_table_name = 'expedicao_aviso_pronto' then 'vibe:' || old.id::text else old.chave end;
begin
  if exists (select 1 from public.imposition_whatsapp_conversas where chave_envio = v_chave) then
    raise exception 'Registro segura a conversa: libere antes de apagar';
  end if;
  return old;
end $f$;
create trigger expedicao_aviso_pronto_trava_nao_apagar before delete on public.expedicao_aviso_pronto
  for each row execute function public.imposition_whatsapp_trava_nao_apagar();
create trigger imposition_whatsapp_artes_trava_nao_apagar before delete on public.imposition_whatsapp_artes
  for each row execute function public.imposition_whatsapp_trava_nao_apagar();
select pg_temp.reg('R3-1 rev3: apagar aviso do Vibe que nao segura conversa', 'ok:apagado',
  pg_temp.tenta($q$delete from public.expedicao_aviso_pronto where id = '00000000-0000-4000-8000-0000000000a1' returning 'apagado'$q$));
select pg_temp.reg('R3-2 rev3: apagar envio de arte que nao segura conversa', 'ok:apagado',
  pg_temp.tenta($q$delete from public.imposition_whatsapp_artes where chave = repeat('a', 64) returning 'apagado'$q$));
select pg_temp.reg('R3-3 rev3: apagar envio de arte que segura a conversa', 'erro:Registro segura a conversa',
  pg_temp.tenta($q$delete from public.imposition_whatsapp_artes where chave = repeat('b', 64) returning 'apagado'$q$));
drop trigger expedicao_aviso_pronto_trava_nao_apagar on public.expedicao_aviso_pronto;
drop trigger imposition_whatsapp_artes_trava_nao_apagar on public.imposition_whatsapp_artes;
drop function public.imposition_whatsapp_trava_nao_apagar();

create table public.chatguru_trava_config (
  id boolean primary key default true check (id),
  margem interval not null default interval '10 seconds' check (margem >= interval '0' and margem <= interval '2 minutes'),
  janela_conferencia interval not null default interval '30 seconds' check (janela_conferencia > interval '0' and janela_conferencia <= interval '10 minutes'),
  atualizado_em timestamptz not null default now());
insert into public.chatguru_trava_config default values;
create function public.chatguru_trava_margem() returns interval language sql stable set search_path to '' as $$
  select coalesce((select margem from public.chatguru_trava_config where id), interval '10 seconds') $$;
create table public.chatguru_trava_registro (
  id bigint generated always as identity primary key,
  destino_chave text not null check (destino_chave ~ '^[a-f0-9]{64}$'),
  origem text not null check (origem in ('vibe', 'imposition')),
  chave text not null,
  evento text not null check (evento in ('reservado', 'executado', 'solto')),
  em timestamptz not null default clock_timestamp());
create index chatguru_trava_registro_destino_em on public.chatguru_trava_registro (destino_chave, em);
create view public.chatguru_trava_conferencia with (security_invoker = true) as
select e.destino_chave, e.origem, e.chave, e.em as executado_em, o.origem as outro_origem, o.chave as outro_chave, o.em as outro_reservado_em,
       round(extract(epoch from o.em - e.em)::numeric, 1) as segundos_depois
  from public.chatguru_trava_registro e
  join public.chatguru_trava_registro o on o.destino_chave = e.destino_chave and o.evento = 'reservado' and o.chave <> e.chave
   and o.em > e.em and o.em <= e.em + (select c.janela_conferencia from public.chatguru_trava_config c where c.id)
 where e.evento = 'executado';
alter table public.chatguru_trava_config enable row level security;
alter table public.chatguru_trava_registro enable row level security;
revoke all on public.chatguru_trava_config from public, anon, authenticated;
revoke all on public.chatguru_trava_registro from public, anon, authenticated;
revoke all on public.chatguru_trava_conferencia from public, anon, authenticated;
revoke all on function public.chatguru_trava_margem() from public, anon, authenticated;
grant execute on function public.chatguru_trava_margem() to service_role;
alter table public.imposition_whatsapp_conversas drop constraint imposition_whatsapp_conversas_chave_envio_fkey;
alter table public.imposition_whatsapp_conversas add constraint imposition_whatsapp_conversas_chave_envio_check
  check (chave_envio is null or chave_envio ~ '^[a-f0-9]{64}$' or chave_envio ~ '^vibe:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
alter table public.imposition_whatsapp_conversas add column livre_em timestamptz;
create index imposition_whatsapp_conversas_chave_envio on public.imposition_whatsapp_conversas (chave_envio) where chave_envio is not null;
create function public.imposition_whatsapp_conversas_dono_existe()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.chave_envio is null then return new; end if;
  if tg_op = 'UPDATE' and new.chave_envio is not distinct from old.chave_envio then return new; end if;
  if new.chave_envio like 'vibe:%' then
    perform 1 from public.expedicao_aviso_pronto where id = substr(new.chave_envio, 6)::uuid for key share;
    if not found then raise exception 'Trava sem aviso do Vibe: %', new.chave_envio using errcode = '23503'; end if;
  else
    perform 1 from public.imposition_whatsapp_artes where chave = new.chave_envio for key share;
    if not found then raise exception 'Trava sem envio de arte: %', new.chave_envio using errcode = '23503'; end if;
  end if;
  return new;
end $$;
create trigger imposition_whatsapp_conversas_dono before insert or update of chave_envio on public.imposition_whatsapp_conversas
  for each row execute function public.imposition_whatsapp_conversas_dono_existe();
create function public.imposition_whatsapp_trava_nao_apagar()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_chave text;
begin
  if current_setting('transaction_isolation') = 'repeatable read' then
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
    raise exception 'Registro % segura a conversa: libere a trava antes de apagar', v_chave using errcode = '23503';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger expedicao_aviso_pronto_trava_nao_apagar before delete or update of id on public.expedicao_aviso_pronto
  for each row execute function public.imposition_whatsapp_trava_nao_apagar();
create trigger imposition_whatsapp_artes_trava_nao_apagar before delete or update of chave on public.imposition_whatsapp_artes
  for each row execute function public.imposition_whatsapp_trava_nao_apagar();
revoke all on function public.imposition_whatsapp_conversas_dono_existe() from public, anon, authenticated;
revoke all on function public.imposition_whatsapp_trava_nao_apagar() from public, anon, authenticated;
create function public.imposition_whatsapp_conversa_travar(p_destino text, p_chave text)
returns text language plpgsql set search_path to '' as $$
declare v record;
begin
  if p_destino is null or p_chave is null then raise exception 'Parametro nulo'; end if;
  if p_destino !~ '^[a-f0-9]{64}$' or p_chave !~ '^vibe:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Parametro invalido'; end if;
  insert into public.imposition_whatsapp_conversas(destino_chave) values (p_destino) on conflict do nothing;
  select chave_envio, livre_em into v from public.imposition_whatsapp_conversas where destino_chave = p_destino for update;
  if v.chave_envio is not null or v.livre_em > clock_timestamp() then return 'ocupado'; end if;
  update public.imposition_whatsapp_conversas set chave_envio = p_chave, livre_em = null, atualizado_em = now() where destino_chave = p_destino;
  insert into public.chatguru_trava_registro(destino_chave, origem, chave, evento) values (p_destino, 'vibe', p_chave, 'reservado');
  return 'reservado';
end $$;
create function public.imposition_whatsapp_conversa_soltar(p_destino text, p_chave text, p_executado boolean)
returns boolean language plpgsql set search_path to '' as $$
begin
  if p_destino is null or p_chave is null or p_executado is null then raise exception 'Parametro nulo'; end if;
  update public.imposition_whatsapp_conversas
     set chave_envio = null, livre_em = case when p_executado then clock_timestamp() + public.chatguru_trava_margem() end, atualizado_em = now()
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
CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_reservar(p_chave text, p_destino text, p_os_id text, p_autor uuid, p_dialogo text, p_repetir boolean DEFAULT false)
 RETURNS text LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE ocupado text; v_livre timestamptz; atual public.imposition_whatsapp_artes;
BEGIN
 INSERT INTO public.imposition_whatsapp_conversas(destino_chave) VALUES(p_destino) ON CONFLICT DO NOTHING;
 SELECT chave_envio, livre_em INTO ocupado, v_livre FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
 IF ocupado IS NOT NULL OR v_livre > clock_timestamp() THEN RETURN 'ocupado'; END IF;
 SELECT * INTO atual FROM public.imposition_whatsapp_artes WHERE chave=p_chave FOR UPDATE;
 IF FOUND THEN
   IF NOT p_repetir OR atual.estado<>'falhou' OR atual.message_id IS NOT NULL OR atual.dialogo_executado OR atual.os_id<>p_os_id THEN RETURN 'existente'; END IF;
   UPDATE public.imposition_whatsapp_artes SET estado='preparando', autor=p_autor, dialogo_id=p_dialogo, atualizado_em=now(), tentativas=tentativas+1 WHERE chave=p_chave;
 ELSE
   INSERT INTO public.imposition_whatsapp_artes(chave,os_id,autor,dialogo_id) VALUES(p_chave,p_os_id,p_autor,p_dialogo) ON CONFLICT DO NOTHING;
   IF NOT FOUND THEN RETURN 'existente'; END IF;
 END IF;
 UPDATE public.imposition_whatsapp_conversas SET chave_envio=p_chave, livre_em=NULL, atualizado_em=now() WHERE destino_chave=p_destino;
 INSERT INTO public.chatguru_trava_registro(destino_chave, origem, chave, evento) VALUES (p_destino, 'imposition', p_chave, 'reservado');
 RETURN 'reservado';
END;
$function$;
CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_reenviar(p_chave text, p_destino text, p_os_id text, p_autor uuid, p_dialogo text, p_atualizado_em timestamp with time zone)
 RETURNS text LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE ocupado text; v_livre timestamptz; atual public.imposition_whatsapp_artes;
BEGIN
 INSERT INTO public.imposition_whatsapp_conversas(destino_chave) VALUES(p_destino) ON CONFLICT DO NOTHING;
 SELECT chave_envio, livre_em INTO ocupado, v_livre FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
 IF ocupado IS NOT NULL OR v_livre > clock_timestamp() THEN RETURN 'ocupado'; END IF;
 SELECT * INTO atual FROM public.imposition_whatsapp_artes WHERE chave=p_chave FOR UPDATE;
 IF NOT FOUND THEN RETURN 'existente'; END IF;
 IF atual.os_id<>p_os_id OR atual.estado NOT IN ('aguardando','enviado')
    OR (atual.message_id IS NULL AND NOT atual.dialogo_executado)
    OR atual.atualizado_em IS DISTINCT FROM p_atualizado_em
    OR clock_timestamp()<atual.atualizado_em+interval '120 seconds' THEN RETURN 'existente'; END IF;
 INSERT INTO public.imposition_whatsapp_reenvios(chave,registro_anterior) VALUES(p_chave,to_jsonb(atual));
 UPDATE public.imposition_whatsapp_artes SET estado='preparando',autor=p_autor, dialogo_id=p_dialogo,dialogo_executado=false,message_id=NULL,concluido=false,
   atualizado_em=clock_timestamp(),tentativas=tentativas+1 WHERE chave=p_chave;
 UPDATE public.imposition_whatsapp_conversas SET chave_envio=p_chave,livre_em=NULL,atualizado_em=clock_timestamp() WHERE destino_chave=p_destino;
 INSERT INTO public.chatguru_trava_registro(destino_chave, origem, chave, evento) VALUES (p_destino, 'imposition', p_chave, 'reservado');
 RETURN 'reservado';
END;
$function$;
CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_finalizar(p_chave text, p_destino text, p_estado text)
 RETURNS SETOF public.imposition_whatsapp_artes LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE ocupado text;
BEGIN
 IF p_estado NOT IN ('aguardando','falhou','desconhecido') THEN RAISE EXCEPTION 'Estado invalido'; END IF;
 SELECT chave_envio INTO ocupado FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
 IF ocupado IS DISTINCT FROM p_chave THEN RAISE EXCEPTION 'Reserva da conversa nao confirmada'; END IF;
 RETURN QUERY UPDATE public.imposition_whatsapp_artes SET estado=p_estado, dialogo_executado=(p_estado='aguardando'), atualizado_em=now()
   WHERE chave=p_chave AND estado='preparando' AND message_id IS NULL AND dialogo_id IS NOT NULL RETURNING *;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registro do dialogo nao confirmado'; END IF;
 IF p_estado<>'desconhecido' THEN
   UPDATE public.imposition_whatsapp_conversas SET chave_envio=NULL,
     livre_em = CASE WHEN p_estado='aguardando' THEN clock_timestamp() + public.chatguru_trava_margem() END, atualizado_em=now() WHERE destino_chave=p_destino;
   INSERT INTO public.chatguru_trava_registro(destino_chave, origem, chave, evento)
     VALUES (p_destino, 'imposition', p_chave, CASE WHEN p_estado='aguardando' THEN 'executado' ELSE 'solto' END);
 END IF;
END;
$function$;
insert into public.imposition_whatsapp_conversas(destino_chave)
  select distinct destino_chave from public.expedicao_aviso_pronto where destino_chave is not null
     and (estado = 'desconhecido' or (estado = 'preparando' and atualizado_em < now() - interval '2 minutes')) on conflict do nothing;
update public.imposition_whatsapp_conversas c set chave_envio = 'vibe:' || a.id::text, atualizado_em = now()
  from public.expedicao_aviso_pronto a where a.destino_chave = c.destino_chave and c.chave_envio is null
   and (a.estado = 'desconhecido' or (a.estado = 'preparando' and a.atualizado_em < now() - interval '2 minutes'));

select pg_temp.reg('P0 passagem: conversas ocupadas por aviso do Vibe', 'ok:0',
  pg_temp.tenta($q$select count(*)::text from public.imposition_whatsapp_conversas where chave_envio like 'vibe:%'$q$));
select pg_temp.reg('1a rev4: apagar aviso do Vibe que nao segura conversa', 'ok:apagado',
  pg_temp.tenta($q$delete from public.expedicao_aviso_pronto where id = '00000000-0000-4000-8000-0000000000a1' returning 'apagado'$q$));
select pg_temp.reg('1b rev4: apagar envio de arte que nao segura conversa', 'ok:apagado',
  pg_temp.tenta($q$delete from public.imposition_whatsapp_artes where chave = repeat('a', 64) returning 'apagado'$q$));
select pg_temp.reg('1c rev4: aviso do Vibe ocupa conversa', 'ok:gravado',
  pg_temp.tenta($q$insert into public.imposition_whatsapp_conversas(destino_chave, chave_envio) values (repeat('1', 64), 'vibe:00000000-0000-4000-8000-0000000000a2') returning 'gravado'$q$));
select pg_temp.reg('1d rev4: apagar aviso do Vibe que segura a conversa', 'erro:Registro vibe:00000000-0000-4000-8000-0000000000a2 segura a conversa',
  pg_temp.tenta($q$delete from public.expedicao_aviso_pronto where id = '00000000-0000-4000-8000-0000000000a2' returning 'apagado'$q$));
select pg_temp.reg('1e rev4: apagar envio de arte que segura a conversa', 'erro:Registro bbbb',
  pg_temp.tenta($q$delete from public.imposition_whatsapp_artes where chave = repeat('b', 64) returning 'apagado'$q$));
select pg_temp.reg('1f rev4: trocar a chave do envio de arte que segura a conversa', 'erro:Registro bbbb',
  pg_temp.tenta($q$update public.imposition_whatsapp_artes set chave = repeat('d', 64) where chave = repeat('b', 64) returning 'trocado'$q$));
select pg_temp.reg('1g rev4: soltar e depois apagar o aviso', 'ok:xok:apagado',
  pg_temp.tenta($q$with s as (update public.imposition_whatsapp_conversas set chave_envio = null where destino_chave = repeat('1', 64) returning 1)
     select 'x' from s$q$) || pg_temp.tenta($q$delete from public.expedicao_aviso_pronto where id = '00000000-0000-4000-8000-0000000000a2' returning 'apagado'$q$));
select pg_temp.reg('2a trava com aviso do Vibe inexistente', 'erro:Trava sem aviso do Vibe',
  pg_temp.tenta($q$insert into public.imposition_whatsapp_conversas(destino_chave, chave_envio) values (repeat('3', 64), 'vibe:00000000-0000-4000-8000-0000000000ff') returning 'gravado'$q$));
select pg_temp.reg('2b trava com envio de arte inexistente', 'erro:Trava sem envio de arte',
  pg_temp.tenta($q$insert into public.imposition_whatsapp_conversas(destino_chave, chave_envio) values (repeat('3', 64), repeat('e', 64)) returning 'gravado'$q$));
select pg_temp.reg('2c chave fora do formato', 'erro:new row for relation "imposition_whatsapp_conversas" violates check constraint',
  pg_temp.tenta($q$insert into public.imposition_whatsapp_conversas(destino_chave, chave_envio) values (repeat('3', 64), 'vibe:nao-uuid') returning 'gravado'$q$));
select pg_temp.reg('2d linha do dono antes da trava: xmax', 'ok:0',
  pg_temp.tenta($q$select xmax::text from public.expedicao_aviso_pronto where id = '00000000-0000-4000-8000-0000000000a3'$q$));
insert into public.imposition_whatsapp_conversas(destino_chave, chave_envio) values (repeat('3', 64), 'vibe:00000000-0000-4000-8000-0000000000a3');
select pg_temp.reg('2e linha do dono depois da trava: presa por esta transacao (xmax = xid)', 'ok:true',
  pg_temp.tenta($q$select (xmax::text::bigint = (txid_current() % 4294967296))::text from public.expedicao_aviso_pronto where id = '00000000-0000-4000-8000-0000000000a3'$q$));
select pg_temp.reg('V1 Vibe travar', 'ok:reservado', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_travar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a4')$q$));
select pg_temp.reg('V2 outro aviso do Vibe na mesma conversa', 'ok:ocupado', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_travar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a3')$q$));
select pg_temp.reg('V3 Imposition reservar com trava do Vibe', 'ok:ocupado', pg_temp.tenta($q$select public.imposition_whatsapp_dialogo_reservar(repeat('c', 64), repeat('4', 64), 'vibe_999999', '00000000-0000-4000-8000-000000000007', '6aef191d04236cee4e7075c1', false)$q$));
select pg_temp.reg('V4 soltar de quem nao e dono', 'ok:false', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_soltar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a3', true)::text$q$));
select pg_temp.reg('V5 Vibe soltar com dialogo executado', 'ok:true', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_soltar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a4', true)::text$q$));
select pg_temp.reg('V6 livre_em = agora + margem (10 s)', 'ok:10', pg_temp.tenta($q$select round(extract(epoch from livre_em - clock_timestamp()))::text from public.imposition_whatsapp_conversas where destino_chave = repeat('4', 64)$q$));
select pg_temp.reg('V7 Imposition reservar dentro da margem', 'ok:ocupado', pg_temp.tenta($q$select public.imposition_whatsapp_dialogo_reservar(repeat('c', 64), repeat('4', 64), 'vibe_999999', '00000000-0000-4000-8000-000000000007', '6aef191d04236cee4e7075c1', false)$q$));
select pg_temp.reg('V8 Vibe travar dentro da margem', 'ok:ocupado', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_travar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a3')$q$));
update public.imposition_whatsapp_conversas set livre_em = clock_timestamp() - interval '1 second' where destino_chave = repeat('4', 64);
select pg_temp.reg('I1 Imposition reservar depois da margem', 'ok:reservado', pg_temp.tenta($q$select public.imposition_whatsapp_dialogo_reservar(repeat('c', 64), repeat('4', 64), 'vibe_999999', '00000000-0000-4000-8000-000000000007', '6aef191d04236cee4e7075c1', false)$q$));
select pg_temp.reg('I2 Vibe travar com trava do Imposition', 'ok:ocupado', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_travar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a3')$q$));
select pg_temp.reg('I3 Imposition finalizar aguardando (executado)', 'ok:aguardando', pg_temp.tenta($q$select estado from public.imposition_whatsapp_dialogo_finalizar(repeat('c', 64), repeat('4', 64), 'aguardando')$q$));
select pg_temp.reg('I4 livre_em do Imposition = agora + margem (10 s)', 'ok:10', pg_temp.tenta($q$select round(extract(epoch from livre_em - clock_timestamp()))::text from public.imposition_whatsapp_conversas where destino_chave = repeat('4', 64)$q$));
select pg_temp.reg('I5 Vibe travar dentro da margem do Imposition', 'ok:ocupado', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_travar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a3')$q$));
select pg_temp.reg('I6 Imposition reenviar dentro da margem', 'ok:ocupado', pg_temp.tenta($q$select public.imposition_whatsapp_dialogo_reenviar(repeat('c', 64), repeat('4', 64), 'vibe_999999', '00000000-0000-4000-8000-000000000007', '6aef191d04236cee4e7075c1', now())$q$));
update public.imposition_whatsapp_conversas set livre_em = clock_timestamp() - interval '1 second' where destino_chave = repeat('4', 64);
select pg_temp.reg('I7 Vibe travar depois da margem do Imposition', 'ok:reservado', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_travar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a3')$q$));
select pg_temp.reg('I8 Vibe soltar sem executar (falhou): sem margem', 'ok:true|', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_soltar(repeat('4', 64), 'vibe:00000000-0000-4000-8000-0000000000a3', false)::text || '|' || coalesce((select livre_em::text from public.imposition_whatsapp_conversas where destino_chave = repeat('4', 64)), '')$q$));
select pg_temp.reg('I9 Imposition reservar, finalizar falhou: solta sem margem', 'ok:reservadook:falhouok:falhou|',
   pg_temp.tenta($q$select public.imposition_whatsapp_dialogo_reservar(repeat('9', 64), repeat('5', 64), 'vibe_999999', '00000000-0000-4000-8000-000000000007', '6aef191d04236cee4e7075c1', false)$q$)
   || pg_temp.tenta($q$select estado from public.imposition_whatsapp_dialogo_finalizar(repeat('9', 64), repeat('5', 64), 'falhou')$q$)
   || pg_temp.tenta($q$select (select estado from public.imposition_whatsapp_artes where chave = repeat('9', 64)) || '|' || (select coalesce(chave_envio, '') || coalesce(livre_em::text, '') from public.imposition_whatsapp_conversas where destino_chave = repeat('5', 64))$q$));
select pg_temp.reg('I10 Imposition desconhecido: segura a conversa', 'ok:reservadook:desconhecidook:8888',
   pg_temp.tenta($q$select public.imposition_whatsapp_dialogo_reservar(repeat('8', 64), repeat('6', 64), 'vibe_999999', '00000000-0000-4000-8000-000000000007', '6aef191d04236cee4e7075c1', false)$q$)
   || pg_temp.tenta($q$select estado from public.imposition_whatsapp_dialogo_finalizar(repeat('8', 64), repeat('6', 64), 'desconhecido')$q$)
   || pg_temp.tenta($q$select chave_envio from public.imposition_whatsapp_conversas where destino_chave = repeat('6', 64)$q$));
select pg_temp.reg('M1 margem configuravel (15 s)', 'ok:00:00:15', pg_temp.tenta($q$with u as (update public.chatguru_trava_config set margem = interval '15 seconds' returning 1) select public.chatguru_trava_margem()::text from u$q$));
select pg_temp.reg('M2 margem acima de 2 min recusada', 'erro:new row for relation "chatguru_trava_config" violates check constraint', pg_temp.tenta($q$update public.chatguru_trava_config set margem = interval '5 minutes' returning 'x'$q$));
select pg_temp.reg('N1 parametro nulo no travar', 'erro:Parametro nulo', pg_temp.tenta($q$select public.imposition_whatsapp_conversa_travar(null, 'vibe:00000000-0000-4000-8000-0000000000a3')$q$));
select pg_temp.reg('R1 registro: eventos na conversa 4', 'ok:', pg_temp.tenta($q$select string_agg(origem || ':' || evento, ', ' order by id) from public.chatguru_trava_registro where destino_chave = repeat('4', 64)$q$));
select pg_temp.reg('R2 conferencia: outro envio ocupou a conversa ate 30 s depois de um executado', 'ok:', pg_temp.tenta($q$select string_agg(origem || '->' || outro_origem || ' ' || segundos_depois || 's', ', ') from public.chatguru_trava_conferencia where destino_chave = repeat('4', 64)$q$));

select n, caso, case when obtido like esperado || '%' then 'PASSA' else 'FALHA' end as resultado, obtido from _r order by n;
rollback;
