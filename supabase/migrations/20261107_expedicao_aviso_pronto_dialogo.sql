-- Aviso "pedido pronto" por diálogo do ChatGuru (07/11/2026).
--
-- Contrato novo (conta WABA): texto livre só chega dentro da janela de 24 h, então
-- o aviso passa a ser chat_update_custom_fields + dialog_execute, com um diálogo
-- por forma de envio. dialog_execute não devolve message_id: o estado final de
-- sucesso é 'executado' (não "entregue").
--
-- TRAVA POR CONVERSA, SÓ NOSSA. Os campos do chat ficam gravados na conversa; dois
-- avisos de pedido pronto para o mesmo número ao mesmo tempo poderiam executar um
-- diálogo com os campos do outro pedido. destino_chave = SHA-256 (hex) de
-- JSON.stringify([endpoint, account_id, phone_id, numero]), o mesmo cálculo do
-- contrato. O índice único parcial deixa uma só tentativa 'preparando' ou
-- 'desconhecido' por conversa: sucesso ('executado') ou recusa explícita
-- ('falhou') liberam; incerteza ('desconhecido') segura a conversa até alguém
-- conferir no ChatGuru. Tabelas e RPCs do Imposition não são tocadas.
--
-- Para voltar:
--   drop function public.expedicao_aviso_pronto_reservar_dialogo(integer, integer, bigint, boolean, uuid, text, text, text);
--   drop index public.expedicao_aviso_pronto_trava_conversa;
--   alter table public.expedicao_aviso_pronto drop column destino_chave, drop column dialogo_id;
--   (antes de voltar o check do estado, trocar as linhas 'executado')
--   alter table public.expedicao_aviso_pronto drop constraint expedicao_aviso_pronto_estado_check,
--     add constraint expedicao_aviso_pronto_estado_check
--     check (estado in ('preparando', 'aguardando', 'enviado', 'falhou', 'desconhecido'));

alter table public.expedicao_aviso_pronto
  drop constraint expedicao_aviso_pronto_estado_check,
  add constraint expedicao_aviso_pronto_estado_check
    check (estado in ('preparando', 'aguardando', 'enviado', 'executado', 'falhou', 'desconhecido'));

alter table public.expedicao_aviso_pronto
  add column if not exists dialogo_id text
    constraint expedicao_aviso_pronto_dialogo_id_check check (dialogo_id is null or dialogo_id ~ '^[a-f0-9]{24}$'),
  add column if not exists destino_chave text
    constraint expedicao_aviso_pronto_destino_chave_check check (destino_chave is null or destino_chave ~ '^[a-f0-9]{64}$');

create unique index if not exists expedicao_aviso_pronto_trava_conversa
  on public.expedicao_aviso_pronto (destino_chave)
  where destino_chave is not null and estado in ('preparando', 'desconhecido');

-- Reserva por diálogo. Devolve {resultado: 'reservado', id} | {resultado: 'ocupado'}
-- (a conversa tem aviso em andamento ou incerto) | {resultado: 'concorrente'}
-- (outra tentativa deste pedido chegou antes).
create or replace function public.expedicao_aviso_pronto_reservar_dialogo(
  p_id_int integer,
  p_seq_atual integer,
  p_id_contato bigint,
  p_modo_teste boolean,
  p_autor uuid,
  p_autor_nome text,
  p_dialogo_id text,
  p_destino_chave text
) returns jsonb
language plpgsql
set search_path to ''
as $$
declare
  v_ultimo record;
  v_id uuid;
begin
  if p_destino_chave is null or p_destino_chave !~ '^[a-f0-9]{64}$' then
    raise exception 'destino_chave invalida';
  end if;
  if p_dialogo_id is null or p_dialogo_id !~ '^[a-f0-9]{24}$' then
    raise exception 'dialogo_id invalido';
  end if;

  select seq, estado into v_ultimo
  from public.expedicao_aviso_pronto
  where id_int = p_id_int
  order by seq desc
  limit 1;

  if coalesce(v_ultimo.seq, 0) <> coalesce(p_seq_atual, 0) or v_ultimo.estado = 'preparando' then
    return jsonb_build_object('resultado', 'concorrente');
  end if;

  if exists (
    select 1 from public.expedicao_aviso_pronto
    where destino_chave = p_destino_chave and estado in ('preparando', 'desconhecido')
  ) then
    return jsonb_build_object('resultado', 'ocupado');
  end if;

  -- Sem alvo: cobre (id_int, seq) e a trava da conversa. Quem perde a corrida não envia.
  insert into public.expedicao_aviso_pronto
    (id_int, seq, id_contato, modo_teste, autor, autor_nome, dialogo_id, destino_chave)
  values
    (p_id_int, coalesce(p_seq_atual, 0) + 1, p_id_contato, p_modo_teste, p_autor, p_autor_nome, p_dialogo_id, p_destino_chave)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    if exists (
      select 1 from public.expedicao_aviso_pronto
      where destino_chave = p_destino_chave and estado in ('preparando', 'desconhecido')
    ) then
      return jsonb_build_object('resultado', 'ocupado');
    end if;
    return jsonb_build_object('resultado', 'concorrente');
  end if;

  return jsonb_build_object('resultado', 'reservado', 'id', v_id);
end;
$$;

revoke all on function public.expedicao_aviso_pronto_reservar_dialogo(integer, integer, bigint, boolean, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.expedicao_aviso_pronto_reservar_dialogo(integer, integer, bigint, boolean, uuid, text, text, text)
  to service_role;
