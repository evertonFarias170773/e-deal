-- Timeline da proposta: uma mensagem por cobrança, com o tipo e com quem agiu.
--
-- POR QUE
--   Cada cobrança gerava DUAS entradas iguais na timeline: esta trigger
--   escrevia a genérica ("Registrada nova cobrança, valor: R$ X") no instante
--   do INSERT, e a aplicação escrevia a específica ("... PIX ...") alguns
--   segundos depois, quando o provedor respondia. Duas camadas registrando o
--   mesmo fato, construídas em épocas diferentes.
--
--   Some a duplicata do lado da aplicação (ver CobrancasProvider) e a trigger
--   passa a dizer o tipo desde o começo — o dado sempre esteve em NEW, só não
--   era usado.
--
--   Junto vai a autoria: a timeline dizia "Financeiro" em tudo, que é a
--   categoria do evento e não quem agiu. Quem gerou a cobrança ficava só em
--   pagamentos_v2.atendente, fora da timeline.
--
-- ORDEM DE PREFERÊNCIA DA AUTORIA
--   1. usuário autenticado (auth.uid) — quem de fato clicou;
--   2. NEW.atendente — vendedor da proposta, usado quando a escrita vem do
--      servidor ou do n8n, onde não há sessão;
--   3. 'Sistema'.
--
-- SEGURANÇA
--   A resolução do autor fica dentro de um bloco com EXCEPTION próprio. Esta
--   trigger roda no INSERT de pagamentos_v2: se ela levantar exceção, a
--   cobrança não é criada. Nenhuma melhoria de registro pode custar isso —
--   na dúvida, grava 'Sistema' e segue.

CREATE OR REPLACE FUNCTION public.tg_registrar_chat_nova_cobranca()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
declare
  v_mensagem text;
  v_tipo     text;
  v_uid      uuid;
  v_autor    text;
begin
  if not exists (select 1 from public.propostas p where p.id_int = new.id_int) then
    return new;
  end if;

  -- Rótulo do tipo. Normalizado porque a coluna carrega variantes históricas
  -- ("E-Faturado" em caixa mista, "CREDIT_CARD" anterior a "CARD_PARCELADO").
  v_tipo := upper(btrim(coalesce(new.tipo_cobranca, '')));
  v_tipo := case v_tipo
    when 'PIX'            then 'PIX'
    when 'BOLETO'         then 'BOLETO'
    when 'CARD_PARCELADO' then 'CARTÃO'
    when 'CREDIT_CARD'    then 'CARTÃO'
    when 'E-CREDITO'      then 'E-CRÉDITO'
    when ''               then null
    else v_tipo
  end;

  -- "Cartão Asas" é marcador de dados, não enfeite: a própria aplicação
  -- consulta a descrição por ele para reaproveitar cobrança pendente.
  if v_tipo = 'CARTÃO' and coalesce(new.descricao, '') ilike '%Cartão Asas%' then
    v_tipo := 'CARTÃO ASAS';
  end if;

  begin
    v_uid := auth.uid();
    if v_uid is not null then
      select u.nome_usuario into v_autor
        from public.usuarios u
       where u.user_id = v_uid;
    end if;
  exception when others then
    -- Sem sessão legível, sem acesso à tabela, o que for: a cobrança vale
    -- mais que o nome de quem a criou.
    v_uid := null;
    v_autor := null;
  end;

  v_autor := coalesce(
    nullif(btrim(coalesce(v_autor, '')), ''),
    nullif(btrim(coalesce(new.atendente, '')), ''),
    'Sistema'
  );

  v_mensagem :=
    'Registrada nova cobrança'
    || coalesce(' ' || v_tipo, '')
    || ', valor: R$ '
    || replace(to_char(new.valor, 'FM9999999990D00'), '.', ',');

  insert into public.propostas_chat (
    id_int,
    id_cliente,
    mensagem,
    tipo,
    autor_uid,
    autor_nome,
    setor,
    visivel_externo,
    created_at
  )
  values (
    new.id_int::bigint,
    new.id_cliente::bigint,
    v_mensagem,
    'SISTEMA',
    v_uid,
    v_autor,
    'Financeiro',
    false,
    coalesce(new.created_at, now())
  );

  return new;
end;
$function$;
