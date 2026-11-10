-- =============================================================================
-- EXCLUIR ITEM DE PRATELEIRA COM MODELO IMPRESSO (10/11/2026) — AUTORIZADA em 10/11/2026, aplicar no SQL Editor
--
-- Autorizada pelo Everton, sem esperar a aprovação do Imposition, depois
-- do teste com ROLLBACK no SQL Editor (A sai com o Histórico; B, C, D e E
-- barrados). O gatilho alterado (carimba_status_impressao_em) é do
-- lado Imposition (usa a variável imposition.retorno_manual_modelo e a RPC
-- retornar_impressao_aguardando). Não está no repositório do Vibe nem no
-- histórico de migrations.
--
-- Decisão do Everton (10/11): o vendedor pode excluir item de prateleira da
-- proposta, mesmo com o modelo marcado como impresso, quando as três coisas
-- são verdade:
--   1. o item é de prateleira (produtos_proposta.is_estoque = true);
--   2. a proposta está em NOVO ou AGUARDANDO (propostas.status_interno);
--   3. não há cobrança paga (pagamentos_v2.status = 'PAID' no id_int).
-- Fora disso, a trava continua como hoje.
--
-- Caso de origem: 24985, item 5420 (#2003), modelo 1007015. Item de prateleira
-- nasce IMPRESSO minutos depois de ir para a aba Pedido; o DELETE do item
-- apaga o modelo em cascata e o gatilho recusava com 23514.
--
-- COMO A EXCEÇÃO FICA FECHADA
--   * Quem decide é um gatilho NOVO em produtos_proposta, BEFORE DELETE: só ele
--     enxerga o item ainda inteiro (na cascata o item já sumiu). Conferidas as
--     três condições, ele grava o Histórico e marca o id do item numa variável
--     LOCAL À TRANSAÇÃO (vibe.exclusao_item_prateleira).
--   * O gatilho do Imposition só deixa passar o DELETE de modelo impresso cujo
--     id_produto_proposta_origem esteja nessa marca. O resto dele é idêntico:
--     a volta de IMPRESSO para outro status (só pela RPC do operador) e a
--     preservação dos carimbos de hora não mudam.
--   * Continua barrado: apagar o modelo impresso direto (aba Pedido, sem
--     excluir o item), item que não é de prateleira, proposta fora de
--     NOVO/AGUARDANDO, proposta com pagamento PAID, e exclusão da proposta
--     inteira (a proposta some antes e o status não é achado).
--   * A exceção só vale na CASCATA: além da marca, o item já tem de ter saído
--     de produtos_proposta. Mesmo quem forjar a marca por SQL não apaga o
--     modelo impresso direto. E a API não expõe set_config.
--   * BEFORE ROW só dispara para linha que passou pela RLS: o perfil Consulta
--     (consulta_nao_apaga) continua sem apagar e não gera Histórico.
--
-- HISTÓRICO: uma linha em propostas_chat (tipo SISTEMA, a Timeline da aba
-- Histórico) com quem excluiu (auth.uid -> usuarios) e cada modelo impresso
-- apagado (id, nome, quantidade, hora da impressão). Item sem modelo impresso
-- segue o caminho normal, sem linha nova.
--
-- REVERSÃO: ao fim do arquivo, comentada. Teste: EXCLUIR-ITEM-PRATELEIRA-IMPRESSO-TESTE.sql.
-- =============================================================================

-- 1. Conferência e Histórico, antes de o item sair ---------------------------
CREATE OR REPLACE FUNCTION public.vibe_liberar_exclusao_item_prateleira()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_status     text;
    v_id_cliente integer;
    v_modelos    text;
    v_uid        uuid;
    v_nome       text;
    v_email      text;
    v_marca      text;
BEGIN
    -- 1. Item de prateleira (a cópia do produto na proposta).
    IF OLD.is_estoque IS NOT TRUE THEN
        RETURN OLD;
    END IF;

    -- 2. Proposta em NOVO ou AGUARDANDO.
    SELECT p.status_interno, p.id_cliente
      INTO v_status, v_id_cliente
      FROM public.propostas p
     WHERE p.id_int = OLD.id_int;
    IF upper(btrim(coalesce(v_status, ''))) NOT IN ('NOVO', 'AGUARDANDO') THEN
        RETURN OLD;
    END IF;

    -- 3. Sem cobrança paga.
    IF EXISTS (SELECT 1 FROM public.pagamentos_v2 g
                WHERE g.id_int = OLD.id_int AND g.status = 'PAID') THEN
        RETURN OLD;
    END IF;

    -- Só há o que liberar e registrar se o item tem modelo impresso
    -- (o mesmo critério do gatilho carimba_status_impressao_em).
    SELECT string_agg(
               format('#%s %s (qtd %s, impresso em %s)',
                      m.id,
                      coalesce(nullif(btrim(m.nome_modelo), ''), 'sem nome'),
                      coalesce(m.quantidade::text, '-'),
                      coalesce(to_char(m.status_impressao_em AT TIME ZONE 'America/Sao_Paulo',
                                       'DD/MM/YYYY HH24:MI'), 'hora não registrada')),
               '; ' ORDER BY m.id)
      INTO v_modelos
      FROM public.pedidos_modelos m
     WHERE m.id_produto_proposta_origem = OLD.id
       AND (upper(btrim(coalesce(m.status_impressao, ''))) = 'IMPRESSO'
            OR m.status_impressao_em IS NOT NULL);
    IF v_modelos IS NULL THEN
        RETURN OLD;
    END IF;

    -- Marca local à transação: só este item libera os modelos dele.
    v_marca := nullif(current_setting('vibe.exclusao_item_prateleira', true), '');
    PERFORM set_config('vibe.exclusao_item_prateleira',
                       coalesce(v_marca || ',', '') || OLD.id::text, true);

    -- Quem fez.
    v_uid := auth.uid();
    IF v_uid IS NOT NULL THEN
        SELECT u.nome_usuario, u.email INTO v_nome, v_email
          FROM public.usuarios u WHERE u.user_id = v_uid LIMIT 1;
    END IF;

    INSERT INTO public.propostas_chat
        (id_int, id_cliente, mensagem, tipo, autor_uid, autor_nome, autor_email, setor, visivel_externo)
    VALUES (
        OLD.id_int,
        v_id_cliente,
        format('Produto de prateleira #%s %s excluído da proposta por %s. Modelo impresso apagado junto: %s.',
               coalesce(OLD.id_produto::text, '-'),
               coalesce(nullif(btrim(OLD.nome_produto), ''), '(sem nome)'),
               CASE
                   WHEN v_nome IS NOT NULL THEN v_nome || coalesce(' (' || v_email || ')', '')
                   WHEN v_uid IS NOT NULL THEN 'usuário ' || v_uid::text
                   ELSE 'acesso sem usuário (' || session_user || ')'
               END,
               v_modelos),
        'SISTEMA',
        v_uid,
        coalesce(v_nome, 'Sistema'),
        v_email,
        'Sistema',
        false
    );

    RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.vibe_liberar_exclusao_item_prateleira() IS
  'BEFORE DELETE em produtos_proposta (10/11/2026): item de prateleira, proposta NOVO/AGUARDANDO e sem pagamento PAID libera o DELETE dos modelos impressos dele (marca vibe.exclusao_item_prateleira, local a transacao) e grava o Historico em propostas_chat.';

REVOKE ALL ON FUNCTION public.vibe_liberar_exclusao_item_prateleira() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vibe_liberar_exclusao_item_prateleira ON public.produtos_proposta;
CREATE TRIGGER trg_vibe_liberar_exclusao_item_prateleira
    BEFORE DELETE ON public.produtos_proposta
    FOR EACH ROW EXECUTE FUNCTION public.vibe_liberar_exclusao_item_prateleira();

-- 2. Gatilho do Imposition: idêntico, com a exceção no ramo DELETE -----------
CREATE OR REPLACE FUNCTION public.carimba_status_impressao_em()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    antes_impresso boolean;
    agora_impresso boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        antes_impresso := upper(btrim(coalesce(OLD.status_impressao, ''))) = 'IMPRESSO';
        IF TG_OP = 'DELETE' THEN
            IF antes_impresso OR OLD.status_impressao_em IS NOT NULL THEN
                -- Exceção (10/11/2026): item de prateleira excluído da proposta
                -- em NOVO/AGUARDANDO sem pagamento. Quem confere é o gatilho
                -- trg_vibe_liberar_exclusao_item_prateleira, que marca o item.
                -- E so na cascata: o item marcado ja saiu. DELETE direto do
                -- modelo (item ainda presente) continua barrado.
                IF OLD.id_produto_proposta_origem IS NOT NULL
                   AND OLD.id_produto_proposta_origem::text = ANY (
                       string_to_array(coalesce(current_setting('vibe.exclusao_item_prateleira', true), ''), ',')
                   )
                   AND NOT EXISTS (SELECT 1 FROM public.produtos_proposta pp
                                    WHERE pp.id = OLD.id_produto_proposta_origem) THEN
                    RETURN OLD;
                END IF;
                RAISE EXCEPTION USING ERRCODE = '23514',
                    MESSAGE = 'Modelo impresso: o registro de impressao e permanente e nao pode ser excluido.';
            END IF;
            RETURN OLD;
        END IF;
    END IF;

    agora_impresso := upper(btrim(coalesce(NEW.status_impressao, ''))) = 'IMPRESSO';
    IF TG_OP = 'INSERT' THEN
        -- O cliente nao escolhe nem antecipa a hora da confirmacao.
        NEW.status_impressao_em := CASE WHEN agora_impresso THEN statement_timestamp() ELSE NULL END;
        RETURN NEW;
    END IF;

    IF antes_impresso THEN
        IF NOT agora_impresso THEN
            IF upper(btrim(coalesce(NEW.status_impressao, ''))) <> 'AGUARDANDO'
               OR current_setting('imposition.retorno_manual_modelo', true) IS DISTINCT FROM OLD.id::text THEN
                RAISE EXCEPTION USING ERRCODE = '23514',
                    MESSAGE = 'Modelo impresso: retornar a Aguardando exige a acao manual do operador.';
            END IF;
            NEW.status_impressao_em := OLD.status_impressao_em;
            RETURN NEW;
        END IF;
        -- Repeticao, caixa/espacos e payloads antigos nao renovam os carimbos.
        NEW.status_impressao := OLD.status_impressao;
        NEW.status_impressao_em := OLD.status_impressao_em;
        NEW.status_impressao_registrado_em := OLD.status_impressao_registrado_em;
        IF NEW.acabamento_status IS NOT DISTINCT FROM OLD.acabamento_status THEN
            NEW.acabamento_status_registrado_em := OLD.acabamento_status_registrado_em;
        END IF;
    ELSIF OLD.status_impressao_em IS NOT NULL THEN
        -- Preservar tambem evidencias legadas; nao inventar uma nova hora.
        NEW.status_impressao_em := OLD.status_impressao_em;
    ELSE
        NEW.status_impressao_em := CASE WHEN agora_impresso THEN statement_timestamp() ELSE NULL END;
    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.carimba_status_impressao_em() IS
  'Protege hora original e impede regressao automatica. Retorno manual via RPC preserva a impressao anterior. SECURITY INVOKER. Excecao 10/11/2026: DELETE de modelo impresso so passa quando o item de prateleira foi liberado por trg_vibe_liberar_exclusao_item_prateleira.';

-- =============================================================================
-- REVERSÃO (não executar junto; só se for desfazer)
--
-- DROP TRIGGER IF EXISTS trg_vibe_liberar_exclusao_item_prateleira ON public.produtos_proposta;
-- DROP FUNCTION IF EXISTS public.vibe_liberar_exclusao_item_prateleira();
-- e recriar public.carimba_status_impressao_em() com o texto "ANTES" guardado em
-- docs/technical/EXCLUIR-ITEM-PRATELEIRA-IMPRESSO.md (o mesmo corpo acima, sem
-- o bloco "Exceção (10/11/2026)"), e o COMMENT original:
--   'Protege hora original e impede regressao automatica. Retorno manual via RPC preserva a impressao anterior. SECURITY INVOKER.'
-- =============================================================================
