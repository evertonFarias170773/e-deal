-- propostas_chat: registro automático pode dizer quem agiu.
--
-- O QUE ESTAVA ACONTECENDO
--   Esta trigger zerava a autoria de TODA mensagem com tipo = 'SISTEMA':
--
--     new.autor_uid := null;  new.autor_nome := 'Sistema';
--
--   Era por isso que as ~19 mil mensagens automáticas apareciam sem autor. Não
--   é que ninguém gravasse — é que a gravação era apagada aqui, uma linha
--   depois. A regra fazia sentido enquanto nenhum escritor sabia quem tinha
--   agido; o único dado de autoria possível era mesmo "Sistema".
--
--   Deixou de fazer quando tg_registrar_chat_nova_cobranca passou a resolver o
--   usuário (auth.uid, com o atendente como reserva). O nome chegava correto e
--   morria aqui.
--
-- O QUE MUDA
--   Só o caso em que o autor foi informado. Registro automático que não diz
--   quem agiu — a imensa maioria: engines de status, automações, n8n —
--   continua sendo normalizado para "Sistema", exatamente como antes. Nada
--   passa a inventar autoria.
--
-- ORDEM DAS TRIGGERS
--   BEFORE INSERT roda em ordem alfabética, então esta corre antes de
--   trg_preencher_autor_propostas_chat, que completa e-mail, avatar e setor a
--   partir de usuarios quando o autor_uid sobrevive. É o efeito desejado.

CREATE OR REPLACE FUNCTION public.fn_normalizar_propostas_chat_autor()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
declare
  v_usuario record;
begin
  -- Mensagem automática do sistema
  if upper(coalesce(new.tipo, '')) = 'SISTEMA' then
    new.tipo := 'SISTEMA';

    -- Sem ator informado, continua sendo o Sistema falando (comportamento
    -- original). Com ator informado, preserva: dizer "Sistema" ali apagava a
    -- única pista de quem gerou a ação.
    if new.autor_nome is null
       or btrim(new.autor_nome) = ''
       or lower(btrim(new.autor_nome)) = 'sistema' then
      new.autor_uid := null;
      new.autor_nome := 'Sistema';
      new.autor_email := null;
      new.avatar := null;
    end if;

    if new.setor is null or trim(new.setor) = '' then
      new.setor := 'Sistema';
    end if;

    new.visivel_externo := coalesce(new.visivel_externo, false);
    return new;
  end if;

  -- Mensagem de usuário interno
  if new.autor_uid is not null then
    select
      u.nome_usuario,
      u.email,
      u.setor,
      u.avatar
    into v_usuario
    from public.usuarios u
    where u.user_id = new.autor_uid
    limit 1;

    new.tipo := coalesce(nullif(new.tipo, ''), 'MENSAGEM');

    if v_usuario is not null then
      new.autor_nome := coalesce(v_usuario.nome_usuario, new.autor_nome);
      new.autor_email := coalesce(v_usuario.email, new.autor_email);
      new.setor := coalesce(v_usuario.setor, new.setor);
      new.avatar := coalesce(v_usuario.avatar, new.avatar);
    end if;

    new.visivel_externo := coalesce(new.visivel_externo, false);
    return new;
  end if;

  -- Fallback seguro
  new.tipo := coalesce(nullif(new.tipo, ''), 'MENSAGEM');
  new.autor_nome := coalesce(nullif(new.autor_nome, ''), 'Sistema');
  new.visivel_externo := coalesce(new.visivel_externo, false);

  return new;
end;
$function$;
