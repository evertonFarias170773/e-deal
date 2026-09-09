-- Timeline da proposta: os três subtipos de faturamento saem com o nome certo.
--
-- POR QUE
--   `tg_registrar_chat_nova_cobranca` traduz os tipos conhecidos e cai no
--   texto CRU para o resto. Até 09/09/2026 isso não tinha efeito prático:
--   E-RETRABALHO, E-PERMUTA e E-AMOSTRA eram barrados na criação e nunca
--   chegavam aqui. Desde d8e17aa eles são criados de verdade — e a timeline
--   passou a gritar "Registrada nova cobrança E-AMOSTRA", em caixa alta, do
--   lado de "E-Amostra" que a Conferência mostra na mesma linha.
--
--   Esta migration só acrescenta os três à tradução, com o MESMO rótulo que a
--   interface usa (`getTipoCobrancaLabel` em cobrancas-utils.ts): E-Retrabalho,
--   E-Permuta e E-Amostra.
--
-- O QUE NÃO MUDA
--   PIX, BOLETO, CARD_PARCELADO, CREDIT_CARD, E-CREDITO, o marcador do Cartão
--   Asas, a resolução de autoria, o bloco EXCEPTION que protege o INSERT e o
--   texto da mensagem. E-FATURADO segue caindo no ramo cru, como sempre —
--   mexer nele mudaria a redação de 350 cobranças de histórico e não é o que
--   está sendo pedido.
--
-- SEGURANÇA
--   Só o CASE de rótulo é tocado. A trigger continua rodando no INSERT de
--   pagamentos_v2; nada aqui pode levantar exceção nova.

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

  v_tipo := upper(btrim(coalesce(new.tipo_cobranca, '')));
  v_tipo := case v_tipo
    when 'PIX'            then 'PIX'
    when 'BOLETO'         then 'BOLETO'
    when 'CARD_PARCELADO' then 'CARTÃO'
    when 'CREDIT_CARD'    then 'CARTÃO'
    when 'E-CREDITO'      then 'E-CRÉDITO'
    -- Subtipos de faturamento, habilitados na criação em 09/09/2026.
    -- Mesmo rótulo da interface, para a timeline e a Conferência dizerem a
    -- mesma coisa sobre a mesma cobrança.
    when 'E-RETRABALHO'   then 'E-Retrabalho'
    when 'E-PERMUTA'      then 'E-Permuta'
    when 'E-AMOSTRA'      then 'E-Amostra'
    when ''               then null
    else v_tipo
  end;

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
