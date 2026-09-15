-- NF-e: duplicata so para parcela com vencimento FUTURO
--
-- O QUE MUDA
--   Em `public.fn_montar_payload_nfe(text)`, o subselect que monta `duplicatas`
--   ganha UMA condicao:
--
--     and nfp.data_vencimento > (now() at time zone 'America/Sao_Paulo')::date
--
--   Parcela forma 15 vencendo na data de emissao (ou antes) deixa de carregar
--   duplicata. `formas_pagamento` NAO muda: a nota continua dizendo que foi paga
--   com forma 15 (boleto), so nao informa cobranca para quem e a vista.
--
-- POR QUE
--   A SEFAZ recusa cobranca em pagamento a vista: rejeicao 853, "Dados de
--   cobranca nao devem ser informados para pagamento a vista". A duplicata era
--   gerada para TODA parcela forma 15, e `codigoFiscalDaCobranca` da 15 para
--   BOLETO, E-CREDITO e rascunho sem cobranca, que nascem vencendo no dia. O
--   faturado tinha o mesmo defeito e foi corrigido na origem em 95ff290 (parcela
--   nasce pela condicao); estes tres chegam pela outra porta.
--
--   A data comparada e a MESMA de `data_emissao` do payload, montada neste mesmo
--   select: `now() at time zone 'America/Sao_Paulo'`. A funcao roda na
--   transmissao (`fn_preparar_envio_nfe`, chamado pelo n8n), entao "futuro" e
--   em relacao ao dia em que a nota sai.
--
-- O QUE NAO MUDA
--   - faturado com vencimento futuro: duplicata igual (numero, vencimento, valor);
--   - `formas_pagamento`, codigos de forma, itens, mascaras de 10 casas,
--     totais, emitente, destinatario, transporte: nada;
--   - notas ja emitidas: o payload delas ja foi gravado; sem backfill.
--
-- COMO E FEITA
--   A funcao tem 17.046 caracteres. Em vez de reescrever o corpo a mao — e
--   arriscar mudar outra coisa sem ver —, a migration le a definicao atual com
--   `pg_get_functiondef`, troca SO a clausula da duplicata e recria com
--   `CREATE OR REPLACE` (que preserva dono, ACL e comentario). Trava antes e
--   depois:
--     a) a funcao tem que estar exatamente como foi lida ao escrever esta
--        migration (md5 do corpo 5c3b59119d9c4effc6adac6276507769);
--     b) a clausula `and nfp.forma_pagamento = '15'` aparece UMA vez;
--     c) depois, desfazendo a troca no corpo novo, volta-se ao md5 original —
--        prova de que nada alem da clausula mudou;
--     d) o ACL (array_agg de grantee) e o mesmo antes e depois;
--     e) a nova clausula esta no corpo.
--   Qualquer falha aborta a migration inteira.
--
-- ACL, REGISTRADO E NAO ALTERADO
--   Antes desta migration: {PUBLIC, anon, authenticated, postgres, service_role}
--   com EXECUTE. `CREATE OR REPLACE` nao mexe nisso, e esta migration nao concede
--   nem revoga nada. O EXECUTE de anon/PUBLIC e anterior e fica registrado aqui
--   para nao passar por resolvido.
--
-- MEDIDO EM 15/09/2026, ANTES DE ESCREVER
--   20 notas nao emitidas; o payload de 2 muda: NFE-20961-001 (E-CREDITO, parcela
--   forma 15 vencida em 26/08) e NFE-22099-001 (E-AMOSTRA, parcela forma 15 em
--   14/09, nascida antes de 95ff290). As duas perdem a duplicata. Nenhuma nao
--   emitida tem parcela ENTRADA.

do $migracao$
declare
  v_oid oid := 'public.fn_montar_payload_nfe(text)'::regprocedure;
  v_def text;
  v_md5_antes text;
  v_acl_antes text;
  v_md5_depois text;
  v_prosrc_depois text;
  v_acl_depois text;
  v_clausula text := $c$and nfp.forma_pagamento = '15'$c$;
  v_nova text;
  v_ocorrencias integer;
begin
  select pg_get_functiondef(p.oid), md5(p.prosrc),
         (select array_agg(coalesce(r.rolname, 'PUBLIC') order by coalesce(r.rolname, 'PUBLIC'))::text
            from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee)
    into v_def, v_md5_antes, v_acl_antes
    from pg_proc p where p.oid = v_oid;

  -- (a)
  if v_md5_antes <> '5c3b59119d9c4effc6adac6276507769' then
    raise exception 'fn_montar_payload_nfe mudou desde que esta migration foi escrita (md5 %). Abortado.', v_md5_antes;
  end if;

  -- (b)
  v_ocorrencias := (length(v_def) - length(replace(v_def, v_clausula, ''))) / length(v_clausula);
  if v_ocorrencias <> 1 then
    raise exception 'Clausula da duplicata aparece % vezes (esperado 1). Abortado.', v_ocorrencias;
  end if;

  v_nova := v_clausula || chr(13) || chr(10)
    || '              -- 15/09/2026: duplicata so com vencimento FUTURO. Parcela que vence' || chr(13) || chr(10)
    || '              -- na data de emissao e pagamento a vista e nao leva cobranca' || chr(13) || chr(10)
    || '              -- (rejeicao 853). Mesma data de `data_emissao`, acima.' || chr(13) || chr(10)
    || '              and nfp.data_vencimento > (now() at time zone ''America/Sao_Paulo'')::date';

  execute replace(v_def, v_clausula, v_nova);

  select p.prosrc, md5(p.prosrc),
         (select array_agg(coalesce(r.rolname, 'PUBLIC') order by coalesce(r.rolname, 'PUBLIC'))::text
            from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee)
    into v_prosrc_depois, v_md5_depois, v_acl_depois
    from pg_proc p where p.oid = v_oid;

  -- (c)
  if md5(replace(v_prosrc_depois, v_nova, v_clausula)) <> v_md5_antes then
    raise exception 'O corpo novo difere do antigo alem da clausula da duplicata. Abortado.';
  end if;

  -- (d)
  if v_acl_depois is distinct from v_acl_antes then
    raise exception 'ACL mudou: % -> %. Abortado.', v_acl_antes, v_acl_depois;
  end if;

  -- (e)
  if position('and nfp.data_vencimento > (now() at time zone ''America/Sao_Paulo'')::date' in v_prosrc_depois) = 0 then
    raise exception 'Clausula nova nao encontrada no corpo. Abortado.';
  end if;

  raise notice 'fn_montar_payload_nfe: md5 % -> %, ACL %', v_md5_antes, v_md5_depois, v_acl_depois;
end
$migracao$;

-- VERIFICACAO (somente leitura, depois de aplicar)
--
--   -- 1) assinatura, SECURITY DEFINER, search_path e ACL preservados
--   select p.oid::regprocedure, p.prosecdef, p.proconfig,
--          (select array_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC'))
--             from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee) grantees
--     from pg_proc p where p.proname = 'fn_montar_payload_nfe';
--   -- esperado: fn_montar_payload_nfe(text), true, {search_path=public},
--   --           {PUBLIC,anon,authenticated,postgres,service_role}
--
--   -- 2) a clausula nova esta la, uma vez
--   select (length(prosrc) - length(replace(prosrc, 'nfp.data_vencimento > (now()', '')))
--          / length('nfp.data_vencimento > (now()') from pg_proc where proname = 'fn_montar_payload_nfe';
--   -- esperado: 1
--
--   -- 3) payloads: resto identico, duplicata so onde o vencimento e futuro
--   select r.ref,
--          md5((public.fn_montar_payload_nfe(r.ref) - 'data_emissao' - 'data_entrada_saida' - 'duplicatas')::text) resto,
--          public.fn_montar_payload_nfe(r.ref)->'duplicatas' duplicatas
--     from (values ('NFE-20961-001'), ('NFE-22099-001'), ('NFE-22066-004'),
--                  ('NFE-21417-001'), ('NFE-21202-001')) r(ref);
--   -- esperado: `resto` igual ao medido antes (6a348822..., e9937b2b..., db38d8c2...,
--   --           17e26341..., f783ff38...); duplicatas [] em NFE-20961-001 e
--   --           NFE-22099-001; NFE-22066-004 com 1 duplicata vencendo 22/09.
--
--   -- 4) nenhuma nota alterada: a migration so troca a funcao
--   select count(*), max(updated_at) from public.notas_fiscais;
--
-- ROLLBACK
--   Recria a funcao sem a clausula, pelo mesmo mecanismo:
--
--   do $r$
--   declare v_def text; v_nova text;
--   begin
--     select pg_get_functiondef('public.fn_montar_payload_nfe(text)'::regprocedure) into v_def;
--     v_nova := $c$and nfp.forma_pagamento = '15'$c$ || chr(13) || chr(10)
--       || '              -- 15/09/2026: duplicata so com vencimento FUTURO. Parcela que vence' || chr(13) || chr(10)
--       || '              -- na data de emissao e pagamento a vista e nao leva cobranca' || chr(13) || chr(10)
--       || '              -- (rejeicao 853). Mesma data de `data_emissao`, acima.' || chr(13) || chr(10)
--       || '              and nfp.data_vencimento > (now() at time zone ''America/Sao_Paulo'')::date';
--     if position(v_nova in v_def) = 0 then raise exception 'clausula nao encontrada'; end if;
--     execute replace(v_def, v_nova, $c$and nfp.forma_pagamento = '15'$c$);
--   end $r$;
--   -- depois: md5(prosrc) deve voltar a 5c3b59119d9c4effc6adac6276507769.
