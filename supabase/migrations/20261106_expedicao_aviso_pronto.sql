-- Aviso "pedido pronto" pelo WhatsApp (ChatGuru) na Expedição (06/11/2026).
--
-- Uma linha por tentativa de aviso de um pedido. A reserva é a linha nascendo
-- em 'preparando' ANTES do POST ao ChatGuru: quem não conseguiu reservar não
-- envia. O par (id_int, seq) é único, então dois cliques ao mesmo tempo nunca
-- viram duas mensagens. "Reenviar" é uma reserva nova (seq + 1), só com a
-- confirmação de qual tentativa a tela estava vendo.
--
-- Guarda só o necessário: estado, message_id, contato, modo teste e quem enviou.
-- Nem a mensagem completa nem a resposta bruta do ChatGuru.
--
-- Acesso só do service_role (Edge Function expedicao-pedido-pronto). RLS ligada
-- sem política; o revoke tira o ALL que o default privileges dá a anon e
-- authenticated em tabela nova.
--
-- Para voltar:
--   drop function public.expedicao_aviso_pronto_reservar(integer, integer, bigint, boolean, uuid, text);
--   drop table public.expedicao_aviso_pronto;

create table if not exists public.expedicao_aviso_pronto (
  id uuid primary key default gen_random_uuid(),
  id_int integer not null,
  seq integer not null check (seq >= 1),
  id_contato bigint,
  modo_teste boolean not null,
  estado text not null default 'preparando'
    check (estado in ('preparando', 'aguardando', 'enviado', 'falhou', 'desconhecido')),
  message_id text check (message_id is null or message_id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  autor uuid not null,
  autor_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_int, seq)
);

comment on table public.expedicao_aviso_pronto is
  'Aviso de pedido pronto pelo ChatGuru (Expedição). Reserva antes do envio; só service_role.';

alter table public.expedicao_aviso_pronto enable row level security;
revoke all on table public.expedicao_aviso_pronto from public, anon, authenticated;
grant all on table public.expedicao_aviso_pronto to service_role;

-- Reserva: só nasce a tentativa seq = p_seq_atual + 1 quando a última tentativa
-- do pedido é mesmo p_seq_atual (0 = nenhuma) e não está em 'preparando'.
-- Devolve o id da reserva, ou null quando outra tentativa chegou antes.
create or replace function public.expedicao_aviso_pronto_reservar(
  p_id_int integer,
  p_seq_atual integer,
  p_id_contato bigint,
  p_modo_teste boolean,
  p_autor uuid,
  p_autor_nome text
) returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_ultimo record;
  v_id uuid;
begin
  select seq, estado into v_ultimo
  from public.expedicao_aviso_pronto
  where id_int = p_id_int
  order by seq desc
  limit 1;

  if coalesce(v_ultimo.seq, 0) <> coalesce(p_seq_atual, 0) then
    return null;
  end if;
  if v_ultimo.estado = 'preparando' then
    return null;
  end if;

  insert into public.expedicao_aviso_pronto (id_int, seq, id_contato, modo_teste, autor, autor_nome)
  values (p_id_int, coalesce(p_seq_atual, 0) + 1, p_id_contato, p_modo_teste, p_autor, p_autor_nome)
  on conflict (id_int, seq) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.expedicao_aviso_pronto_reservar(integer, integer, bigint, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function public.expedicao_aviso_pronto_reservar(integer, integer, bigint, boolean, uuid, text)
  to service_role;
