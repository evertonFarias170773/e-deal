-- alteração do Vibe em 11/11/2026; incorporar no arquivo do Imposition
--
-- public.link_cliente_salvar_faturamento é do portal do link do cliente (Imposition,
-- ideal-imposition.vercel.app). O portal manda a rua como objeto, que chega como o texto
-- "[object Object]", e a função regravava a rua do endereço PRINCIPAL do cliente CPF.
-- Mudança (autorização nominal do dono, 11/11/2026):
--   1. Cliente CPF existente: com p_cadastro->>'endereco' ILIKE '[object%', nenhum campo do
--      endereço PRINCIPAL é alterado (nem criado). O resto da função segue igual.
--   2. Cliente novo: com '[object%', a rua é gravada vazia, sem erro ao portal.
--   A validação de rua vazia segue como estava (devolve erro). EXECUTE, GRANT e policy não mudam.
-- Antes: md5(pg_get_functiondef) = 5d04b1af85f9d835d4e1d37a71b89690.
-- Restauração: só a coluna endereco dos 18 clientes regravados pelo portal desde 14/10, com o
-- valor anterior registrado em audit.logs_v2, e só onde a rua atual ainda é '[object Object]'.
-- 66182 e 45440 (sem registro do portal) ficam como estão.

CREATE OR REPLACE FUNCTION public.link_cliente_salvar_faturamento(p_numero text, p_token text, p_id_cliente integer, p_cadastro jsonb, p_novo boolean, p_anterior_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_link public.pedidos_links_cliente%ROWTYPE;
    v_prop public.propostas%ROWTYPE;
    v_depois public.propostas%ROWTYPE;
    v_cli public.clientes%ROWTYPE;
    v_end public.enderecos%ROWTYPE;
    v_portal jsonb;
    v_id integer;
    v_documento text;
    v_tipo text;
    v_chave text;
    v_quantidade integer;
    v_seq text;
    v_soma integer;
    v_n integer;
    v_i integer;
    -- Alteração do Vibe em 11/11/2026 (incorporar no arquivo do Imposition): o portal manda
    -- a rua como objeto, que chega como "[object Object]".
    v_rua_objeto boolean := coalesce(p_cadastro->>'endereco', '') ILIKE '[object%';
BEGIN
    SELECT * INTO STRICT v_link FROM public.pedidos_links_cliente
     WHERE numero_pedido = p_numero AND token = p_token AND ativo IS TRUE FOR UPDATE;
    IF p_numero !~ '^[1-9][0-9]*$'
       OR (v_link.id_int IS NOT NULL AND v_link.id_int::text <> p_numero) THEN
        RAISE EXCEPTION 'link incompatível com o pedido';
    END IF;
    SELECT * INTO STRICT v_prop FROM public.propostas WHERE id_int = p_numero::bigint FOR UPDATE;
    IF v_prop.id_cliente IS NULL THEN RAISE EXCEPTION 'pedido sem cliente'; END IF;
    IF COALESCE(v_prop.id_faturado, v_prop.id_cliente) IS DISTINCT FROM p_anterior_id THEN
        RAISE EXCEPTION 'os dados da nota mudaram; reabra o link';
    END IF;
    IF jsonb_typeof(p_cadastro) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'cadastro inválido'; END IF;

    FOREACH v_chave IN ARRAY ARRAY['nome','documento','ins_estadual','email','telefone','cep','endereco',
        'numero','complemento','bairro','cidade','uf'] LOOP
        IF jsonb_typeof(p_cadastro->v_chave) IS DISTINCT FROM 'string'
           OR p_cadastro->>v_chave IS DISTINCT FROM btrim(p_cadastro->>v_chave)
           OR (v_chave NOT IN ('ins_estadual','email','telefone','complemento') AND btrim(p_cadastro->>v_chave) = '')
           OR length(p_cadastro->>v_chave) > (CASE v_chave WHEN 'nome' THEN 150 WHEN 'documento' THEN 14
                WHEN 'ins_estadual' THEN 30 WHEN 'email' THEN 150 WHEN 'telefone' THEN 30 WHEN 'cep' THEN 8
                WHEN 'endereco' THEN 200 WHEN 'numero' THEN 20 WHEN 'complemento' THEN 150
                WHEN 'uf' THEN 2 ELSE 100 END) THEN
            RAISE EXCEPTION 'campo fiscal inválido: %', v_chave;
        END IF;
    END LOOP;
    v_documento := p_cadastro->>'documento';
    IF v_documento !~ '^([0-9]{11}|[0-9]{14})$' OR v_documento = repeat(substr(v_documento,1,1),length(v_documento))
       OR p_cadastro->>'cep' !~ '^[0-9]{8}$' OR p_cadastro->>'uf' !~ '^[A-Z]{2}$' THEN
        RAISE EXCEPTION 'documento, CEP ou UF inválido';
    END IF;
    v_tipo := CASE length(v_documento) WHEN 11 THEN 'CPF' ELSE 'CNPJ' END;
    IF v_tipo = 'CPF' THEN
        FOR v_n IN 9..10 LOOP
            v_soma := 0;
            FOR v_i IN 1..v_n LOOP
                v_soma := v_soma + substr(v_documento,v_i,1)::integer * (v_n + 2 - v_i);
            END LOOP;
            IF mod(mod(v_soma * 10,11),10) <> substr(v_documento,v_n+1,1)::integer THEN
                RAISE EXCEPTION 'CPF inválido';
            END IF;
        END LOOP;
    ELSE
        FOR v_n IN 1..2 LOOP
            v_soma := 0;
            FOR v_i IN 1..(11 + v_n) LOOP
                v_soma := v_soma + substr(v_documento,v_i,1)::integer *
                    CASE WHEN v_i <= (3 + v_n) THEN (5 + v_n - v_i) ELSE (13 + v_n - v_i) END;
            END LOOP;
            IF (CASE WHEN mod(v_soma,11) < 2 THEN 0 ELSE 11 - mod(v_soma,11) END)
                <> substr(v_documento,12+v_n,1)::integer THEN
                RAISE EXCEPTION 'CNPJ inválido';
            END IF;
        END LOOP;
    END IF;

    IF p_novo THEN
        -- Serializa a criacao do mesmo documento entre chamadas do portal.
        PERFORM pg_advisory_xact_lock(hashtextextended('portal-cadastro-documento:' || v_documento, 0));
        -- Inclui cadastros inativos e documentos com ou sem pontuacao.
        -- Nao revela nem associa um cadastro de terceiro apenas pelo documento.
        IF EXISTS (SELECT 1 FROM public.clientes c
                    WHERE regexp_replace(coalesce(c.documento,''),'\D','','g') = v_documento) THEN
            RAISE EXCEPTION 'este documento já possui cadastro; procure o atendimento para vinculá-lo';
        END IF;
        -- Omitir id_cliente aciona o DEFAULT oficial fn_proximo_id_cliente().
        INSERT INTO public.clientes (nome, fantasia, documento, tipo_pessoa, ins_estadual,
            email_financeiro, whatsapp_1, ativo, data_cadastro)
        VALUES (p_cadastro->>'nome', CASE WHEN v_tipo = 'CNPJ' THEN p_cadastro->>'nome' ELSE NULL END,
            v_documento, CASE WHEN v_tipo = 'CNPJ' THEN 'JURIDICA' ELSE 'FISICA' END,
            NULLIF(p_cadastro->>'ins_estadual',''), NULLIF(p_cadastro->>'email',''),
            NULLIF(p_cadastro->>'telefone',''), true, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)
        RETURNING id_cliente INTO STRICT v_id;
        -- Vibe 11/11/2026: rua "[object..." vira rua vazia no cliente novo, sem erro ao portal.
        INSERT INTO public.enderecos (id_cliente, tipo_endereco, obs, cep, endereco, numero, complemento, bairro, cidade, uf)
        VALUES (v_id, 'PRINCIPAL', 'portal-faturamento', p_cadastro->>'cep',
            CASE WHEN v_rua_objeto THEN '' ELSE p_cadastro->>'endereco' END,
            p_cadastro->>'numero', p_cadastro->>'complemento', p_cadastro->>'bairro',
            p_cadastro->>'cidade', p_cadastro->>'uf');
    ELSE
        v_id := p_id_cliente;
        IF v_id IS NULL OR NOT (
            v_id IN (v_prop.id_cliente, COALESCE(v_prop.id_faturado, v_prop.id_cliente))
            OR EXISTS (SELECT 1 FROM public.clientes_socios s
                        WHERE s.id_cliente_principal = v_prop.id_cliente
                          AND s.id_cliente_socio = v_id
                          AND lower(btrim(coalesce(s.tipo_relacao, ''))) IN ('faturamento','vinculo_comercial'))
            OR EXISTS (SELECT 1 FROM public.clientes_faturamento_portal f
                        WHERE f.id_cliente_titular = v_prop.id_cliente AND f.id_cliente_faturamento = v_id)
        ) THEN RAISE EXCEPTION 'cadastro fiscal não pertence a este cliente'; END IF;
        SELECT * INTO STRICT v_cli FROM public.clientes WHERE id_cliente = v_id FOR UPDATE;
        v_documento := regexp_replace(coalesce(v_cli.documento,''),'[^0-9]','','g');
        IF length(v_documento) = 11 THEN
            -- CPF pode ser editado, mas o documento que identifica o cadastro nao muda.
            IF p_cadastro->>'documento' <> v_documento THEN RAISE EXCEPTION 'o CPF do cadastro não pode ser trocado'; END IF;
            UPDATE public.clientes SET nome = p_cadastro->>'nome', ins_estadual = NULLIF(p_cadastro->>'ins_estadual',''),
                email_financeiro = NULLIF(p_cadastro->>'email',''), whatsapp_1 = NULLIF(p_cadastro->>'telefone','')
             WHERE id_cliente = v_id;
            -- Vibe 11/11/2026: rua "[object..." não altera (nem cria) o endereço PRINCIPAL.
            IF NOT v_rua_objeto THEN
                SELECT * INTO v_end FROM public.enderecos WHERE id_cliente = v_id
                 ORDER BY CASE WHEN upper(btrim(coalesce(tipo_endereco,''))) = 'PRINCIPAL' THEN 0 ELSE 1 END,
                          data_criacao DESC NULLS LAST, id LIMIT 1 FOR UPDATE;
                IF v_end.id IS NULL THEN
                    INSERT INTO public.enderecos (id_cliente,tipo_endereco,obs,cep,endereco,numero,complemento,bairro,cidade,uf)
                    VALUES (v_id,'PRINCIPAL','portal-faturamento',p_cadastro->>'cep',p_cadastro->>'endereco',
                        p_cadastro->>'numero',p_cadastro->>'complemento',p_cadastro->>'bairro',p_cadastro->>'cidade',p_cadastro->>'uf');
                ELSE
                    UPDATE public.enderecos SET cep=p_cadastro->>'cep', endereco=p_cadastro->>'endereco',
                        numero=p_cadastro->>'numero', complemento=p_cadastro->>'complemento', bairro=p_cadastro->>'bairro',
                        cidade=p_cadastro->>'cidade', uf=p_cadastro->>'uf' WHERE id=v_end.id;
                END IF;
            END IF;
        ELSIF length(v_documento) <> 14 THEN
            RAISE EXCEPTION 'cadastro sem CPF ou CNPJ válido';
        END IF;
    END IF;

    INSERT INTO public.clientes_faturamento_portal (id_cliente_titular,id_cliente_faturamento)
    VALUES (v_prop.id_cliente,v_id) ON CONFLICT DO NOTHING;
    -- Portal fiscal: manter o vinculo reconhecido pelo box 4 do ERP.
    -- Nao criar auto-vinculo nem modificar relacoes comerciais preexistentes.
    IF v_id <> v_prop.id_cliente THEN
        INSERT INTO public.clientes_socios
            (id_cliente_principal, id_cliente_socio, tipo_relacao)
        VALUES (v_prop.id_cliente, v_id, 'faturamento')
        ON CONFLICT (id_cliente_principal, id_cliente_socio) DO NOTHING;
        IF NOT EXISTS (
            SELECT 1 FROM public.clientes_socios
             WHERE id_cliente_principal = v_prop.id_cliente AND id_cliente_socio = v_id
        ) THEN
            RAISE EXCEPTION 'vinculo fiscal do ERP nao confirmado';
        END IF;
    END IF;
    UPDATE public.propostas SET id_faturado = v_id WHERE id_int = p_numero::bigint;
    GET DIAGNOSTICS v_quantidade = ROW_COUNT;
    IF v_quantidade <> 1 THEN RAISE EXCEPTION 'vínculo fiscal não confirmado'; END IF;
    SELECT * INTO STRICT v_depois FROM public.propostas WHERE id_int = p_numero::bigint;
    IF (to_jsonb(v_depois) - ARRAY['id_faturado','updated_at'])
        IS DISTINCT FROM (to_jsonb(v_prop) - ARRAY['id_faturado','updated_at']) THEN
        RAISE EXCEPTION 'a atualização afetaria outros dados do pedido; procure o atendimento';
    END IF;
    v_portal := public.link_cliente_pedido(p_numero,p_token);
    IF (v_portal->'pedido'->>'id_cliente')::integer IS DISTINCT FROM v_id THEN
        RAISE EXCEPTION 'cadastro fiscal persistido diverge do solicitado';
    END IF;
    RETURN jsonb_build_object('ok',true,'numero',p_numero,'id_cliente',v_id,
        'cliente',v_portal->'cliente','endereco_faturamento',v_portal->'endereco_faturamento',
        'cadastros_faturamento',v_portal->'cadastros_faturamento');
END;
$function$;

-- Restauração da rua dos 18 clientes (só a coluna endereco; trava na rua atual).
DO $restaura$
DECLARE n integer;
BEGIN
    WITH ev AS (
        SELECT DISTINCT ON (l.record_pk->>'id') (l.record_pk->>'id')::uuid AS id_end,
               l.changed_fields->'endereco'->>'old' AS rua_anterior
          FROM audit.logs_v2 l
         WHERE l.table_name = 'enderecos' AND l.actor_role = 'anon'
           AND l.new_data->>'endereco' = '[object Object]'
           AND l.changed_fields ? 'endereco'
         ORDER BY l.record_pk->>'id', l.occurred_at DESC
    )
    UPDATE public.enderecos e SET endereco = ev.rua_anterior
      FROM ev
     WHERE e.id = ev.id_end AND e.endereco = '[object Object]'
       AND e.id_cliente IN (66726,1735,18379,4150,40672,65863,19014,51203,66770,26577,
                            20890,55493,45646,36023,16415,25847,42521,62325);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 18 THEN RAISE EXCEPTION 'restauração alteraria % ruas, esperado no máximo 18', n; END IF;
    RAISE NOTICE 'ruas restauradas: %', n;
END
$restaura$;

-- ROLLBACK da função: reaplicar a definição anterior (md5 5d04b1af85f9d835d4e1d37a71b89690),
-- que é este mesmo arquivo sem as três marcas "Vibe 11/11/2026" (v_rua_objeto) — a fonte original
-- é o arquivo do Imposition. As ruas restauradas não têm volta: o valor anterior era "[object Object]".
