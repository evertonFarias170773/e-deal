-- =====================================================================
-- Reversao da trava compartilhada ChatGuru (Vibe + Imposition) - revisao 4
--
-- Mesmo texto do rodape de CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql, pronto
-- para rodar. So com autorizacao nominal e com os envios dos dois lados
-- pausados (roteiro: docs/technical/CHATGURU-TRAVA-JANELA.md, Volta).
--
-- Rodar o arquivo INTEIRO numa execucao do SQL Editor. Sem BEGIN e sem COMMIT
-- de proposito: o editor roda tudo numa transacao implicita; se qualquer
-- comando falhar (inclusive a drenagem da primeira linha), nada fica feito e
-- nenhuma transacao fica aberta.
--
-- Antes: guardar uma copia de chatguru_trava_registro (Exportar CSV no editor:
-- select * from public.chatguru_trava_registro order by id), que e apagada aqui.
-- =====================================================================

select public.chatguru_trava_drenagem(true);  -- aborta se houver envio em andamento
-- solta as travas do Vibe (a chave estrangeira volta e não aceita 'vibe:')
update public.imposition_whatsapp_conversas set chave_envio = null, atualizado_em = now()
 where chave_envio like 'vibe:%';
drop trigger imposition_whatsapp_conversas_dono on public.imposition_whatsapp_conversas;
drop trigger expedicao_aviso_pronto_trava_nao_apagar on public.expedicao_aviso_pronto;
drop trigger imposition_whatsapp_artes_trava_nao_apagar on public.imposition_whatsapp_artes;
drop function public.imposition_whatsapp_conversas_dono_existe();
drop function public.imposition_whatsapp_trava_nao_apagar();
drop function public.imposition_whatsapp_conversa_travar(text, text);
drop function public.imposition_whatsapp_conversa_soltar(text, text, boolean);

CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_reservar(p_chave text, p_destino text, p_os_id text, p_autor uuid, p_dialogo text, p_repetir boolean DEFAULT false)
 RETURNS text LANGUAGE plpgsql SET search_path TO ''
AS $function$
DECLARE ocupado text; atual public.imposition_whatsapp_artes;
BEGIN
 INSERT INTO public.imposition_whatsapp_conversas(destino_chave) VALUES(p_destino) ON CONFLICT DO NOTHING;
 SELECT chave_envio INTO ocupado FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
 IF ocupado IS NOT NULL THEN RETURN 'ocupado'; END IF;
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
 UPDATE public.imposition_whatsapp_conversas SET chave_envio=p_chave, atualizado_em=now() WHERE destino_chave=p_destino;
 RETURN 'reservado';
END;
$function$;

CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_reenviar(p_chave text, p_destino text, p_os_id text, p_autor uuid, p_dialogo text, p_atualizado_em timestamp with time zone)
 RETURNS text LANGUAGE plpgsql SET search_path TO ''
AS $function$
DECLARE ocupado text; atual public.imposition_whatsapp_artes;
BEGIN
 INSERT INTO public.imposition_whatsapp_conversas(destino_chave) VALUES(p_destino) ON CONFLICT DO NOTHING;
 SELECT chave_envio INTO ocupado FROM public.imposition_whatsapp_conversas WHERE destino_chave=p_destino FOR UPDATE;
 IF ocupado IS NOT NULL THEN RETURN 'ocupado'; END IF;
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
 UPDATE public.imposition_whatsapp_conversas SET chave_envio=p_chave,atualizado_em=clock_timestamp() WHERE destino_chave=p_destino;
 RETURN 'reservado';
END;
$function$;

CREATE OR REPLACE FUNCTION public.imposition_whatsapp_dialogo_finalizar(p_chave text, p_destino text, p_estado text)
 RETURNS SETOF public.imposition_whatsapp_artes LANGUAGE plpgsql SET search_path TO ''
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
   UPDATE public.imposition_whatsapp_conversas SET chave_envio=NULL, atualizado_em=now() WHERE destino_chave=p_destino;
 END IF;
END;
$function$;

drop index public.imposition_whatsapp_conversas_chave_envio;
alter table public.imposition_whatsapp_conversas drop column livre_em;
alter table public.imposition_whatsapp_conversas drop constraint imposition_whatsapp_conversas_chave_envio_check;
alter table public.imposition_whatsapp_conversas
  add constraint imposition_whatsapp_conversas_chave_envio_fkey
  foreign key (chave_envio) references public.imposition_whatsapp_artes(chave);
drop view public.chatguru_trava_conferencia;
drop function public.chatguru_trava_margem();
drop table public.chatguru_trava_registro;   -- guardar uma cópia antes, se já tiver linhas
drop table public.chatguru_trava_config;
drop function public.chatguru_trava_drenagem(boolean);
