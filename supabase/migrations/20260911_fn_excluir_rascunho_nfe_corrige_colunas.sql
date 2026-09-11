-- fn_excluir_rascunho_nfe: tres nomes de coluna errados, e o ACL que os escondia.
--
-- POR QUE
--   A funcao existe desde sempre e NUNCA excluiu nada. Ela referencia tres
--   colunas que nao existem, e em plpgsql o campo de um `record` e o SQL de um
--   DELETE so sao resolvidos em EXECUCAO — entao ela passava na criacao e
--   morria em 42703 no primeiro uso real:
--
--     v_nota.numero_nfe                  -> a coluna e `numero_nf`
--     notas_fiscais_pagamentos.ref_nfe   -> a coluna e `ref`
--     notas_fiscais_itens.ref_nfe        -> a coluna e `ref`
--
--   O efeito era perverso: ela RECUSAVA corretamente o que nao e rascunho
--   (esse guarda vem antes e usa `status`, que existe) e ESTOURAVA em tudo que
--   e. Quem testasse com uma nota autorizada veria a recusa educada e concluiria
--   que a funcao funciona.
--
--   Nenhum ponto do `src` a chama. A UI nao tem exclusao de nota: o unico
--   `.delete()` das telas fiscais e `deleteNfeItem`, que apaga ITEM.
--
-- O QUE ESTA MIGRATION FAZ, E SO ISSO
--   1. Corrige os tres nomes de coluna. Nenhuma regra muda.
--   2. Acrescenta UM guarda novo, que so RECUSA (detalhe abaixo).
--   3. Fecha o ACL: tira PUBLIC e `anon`.
--
--   NAO APAGA NENHUMA NOTA. Nao mexe em empresas.ambiente_nfe, nao emite, nao
--   transmite, nao consulta. A NFE-20370-002 (autorizada em homologacao como
--   NF 1002 e registrada como PROCESSANDO) nao e tocada, e continuaria sendo
--   recusada por esta funcao de qualquer forma: PROCESSANDO nao esta na lista
--   aceita.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- O ACL E A PARTE MAIS IMPORTANTE DESTE ARQUIVO
-- ═══════════════════════════════════════════════════════════════════════════
--   Antes desta migration:
--     {=X/postgres, postgres=X/postgres, anon=X/postgres,
--      authenticated=X/postgres, service_role=X/postgres}
--
--   Uma funcao SECURITY DEFINER, dona `postgres`, que APAGA linhas — ao alcance
--   do PUBLIC e do `anon`. Hoje e inofensiva porque esta quebrada. Consertar
--   sem tocar no ACL seria entregar, no mesmo commit, um DELETE de nota fiscal
--   acionavel por qualquer um que tenha a anon key e uma `ref`. O conserto e o
--   REVOKE tem que viajar juntos.
--
--   DOIS REVOKEs, nao um. `REVOKE ... FROM PUBLIC` nao alcanca grant nominal:
--   o `anon=X/postgres` e nominal e sobreviveria. E CREATE OR REPLACE PRESERVA
--   o ACL existente — nao reseta nada. Sem estas linhas o buraco fica aberto.
--
--   `authenticated` FICA: e assim que o app fala com o banco, e e o que vai
--   permitir a acao na tela quando ela existir. `service_role` fica para o n8n.
--
--   As outras SETE RPCs fiscais (fn_criar_rascunho_nfe, fn_montar_payload_nfe,
--   fn_preparar_envio_nfe, fn_trocar_empresa_nfe, fn_salvar_retorno_focus_nfe,
--   fn_gerar_pagamentos_nfe, fn_clonar_rascunho_nfe) TAMBEM tem `anon`, pelo
--   mesmo ALTER DEFAULT PRIVILEGES do schema. NAO sao tocadas aqui: cada uma
--   precisa de analise propria de quem a chama, e misturar isso com um conserto
--   de coluna e como esconder duas mudancas num commit so.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- O GUARDA NOVO: notas_eventos
-- ═══════════════════════════════════════════════════════════════════════════
--   Ha uma TERCEIRA filha que a funcao original nao conhecia: `notas_eventos`
--   (carta de correcao e cancelamento), ligada por `ref`. Como nao ha FOREIGN
--   KEY nenhuma em notas_fiscais — nem entrando nem saindo —, nada impediria o
--   DELETE de deixar evento orfao.
--
--   A resposta aqui NAO e apagar mais coisa. Ampliar o alcance de um DELETE e
--   o tipo de conserto que se descobre tarde. A resposta e RECUSAR: nota que
--   tem evento nao e rascunho, aconteca o que disser a coluna `status`. O
--   guarda so estreita o que passa; nao afrouxa nada.
--
--   Na pratica ele nunca deveria disparar — evento so existe em nota
--   autorizada, que os guardas anteriores ja barram. Ele existe para o caso em
--   que o `status` mente. Medido em 11/09/2026: `notas_eventos` tem 6 linhas,
--   NENHUMA de NFE-20370-*.
--
-- O QUE CONTINUA EXATAMENTE COMO ESTAVA
--   . a lista de status aceitos: RASCUNHO, PENDENTE, ERRO_VALIDACAO,
--     ERRO_ENVIO, PRONTA_PARA_ENVIO. Nao entra ninguem novo — em especial nao
--     entram PROCESSANDO, AUTORIZADA, CANCELADA, DENEGADA nem ERRO_AUTORIZACAO;
--   . a recusa por dados fiscais: numero, chave, protocolo, caminho_xml,
--     caminho_danfe. Mesmos cinco campos, mesma regra, um deles agora com o
--     nome certo;
--   . a ordem: filhas primeiro, pai depois. Assim o DELETE nao cria orfao;
--   . os codigos de erro devolvidos (NFE_NAO_ENCONTRADA,
--     NFE_NAO_PODE_SER_EXCLUIDA, NFE_COM_DADOS_FISCAIS), porque qualquer tela
--     futura vai le-los;
--   . SECURITY DEFINER e search_path=public;
--   . RLS: nada e alterado em politica nenhuma.
--
-- CONTEXTO DE NUMEROS, medido em 11/09/2026
--   15 notas estao hoje nos status que esta funcao aceita: 1 da Biro
--   (NFE-20370-001), 3 da Ideal Grafica e 11 da E3. NENHUMA e excluida aqui.
--   Existem 112 linhas filhas ja orfas no banco (38 itens e 74 pagamentos
--   apontando para nota inexistente), anteriores a esta migration e nao
--   tratadas por ela.

-- ============================================================================
-- 1. A FUNCAO
-- ============================================================================

create or replace function public.fn_excluir_rascunho_nfe(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nota    record;
  v_eventos integer;
begin
  select *
  into v_nota
  from public.notas_fiscais
  where ref = p_ref
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'erro', 'NFE_NAO_ENCONTRADA',
      'mensagem', 'NF-e não encontrada.'
    );
  end if;

  if v_nota.status not in ('RASCUNHO', 'PENDENTE', 'ERRO_VALIDACAO', 'ERRO_ENVIO', 'PRONTA_PARA_ENVIO') then
    return jsonb_build_object(
      'ok', false,
      'erro', 'NFE_NAO_PODE_SER_EXCLUIDA',
      'mensagem', 'Esta NF-e não pode ser excluída porque não está mais em rascunho.'
    );
  end if;

  -- `numero_nf`, e nao `numero_nfe`: era aqui que a funcao morria em 42703.
  if v_nota.numero_nf is not null
     or v_nota.chave_nfe is not null
     or v_nota.protocolo is not null
     or v_nota.caminho_xml is not null
     or v_nota.caminho_danfe is not null then
    return jsonb_build_object(
      'ok', false,
      'erro', 'NFE_COM_DADOS_FISCAIS',
      'mensagem', 'Esta NF-e já possui dados fiscais e não deve ser excluída.'
    );
  end if;

  -- Guarda novo, so recusa: nota com carta de correcao ou evento de
  -- cancelamento nao e rascunho, diga o `status` o que disser. Sem FK no
  -- banco, apagar aqui deixaria o evento orfao — entao nao se apaga: nega-se.
  select count(*) into v_eventos
  from public.notas_eventos
  where ref = p_ref;

  if v_eventos > 0 then
    return jsonb_build_object(
      'ok', false,
      'erro', 'NFE_COM_EVENTOS',
      'mensagem', format(
        'Esta NF-e tem %s evento(s) registrado(s) (carta de correção ou cancelamento) e não pode ser excluída.',
        v_eventos
      )
    );
  end if;

  -- Filhas primeiro, pai depois. A coluna e `ref` nas duas — nunca foi
  -- `ref_nfe`, e era o segundo e o terceiro 42703 desta funcao.
  delete from public.notas_fiscais_pagamentos
  where ref = p_ref;

  delete from public.notas_fiscais_itens
  where ref = p_ref;

  delete from public.notas_fiscais
  where ref = p_ref;

  return jsonb_build_object(
    'ok', true,
    'mensagem', 'Rascunho de NF-e excluído com sucesso.',
    'ref', p_ref
  );
end;
$function$;

-- ============================================================================
-- 2. O ACL
-- ============================================================================
--   Ordem importa: PUBLIC primeiro, nominais depois. Um nao substitui o outro.

revoke all on function public.fn_excluir_rascunho_nfe(text) from public;
revoke all on function public.fn_excluir_rascunho_nfe(text) from anon;

grant execute on function public.fn_excluir_rascunho_nfe(text) to authenticated;
grant execute on function public.fn_excluir_rascunho_nfe(text) to service_role;

-- ============================================================================
-- 3. VERIFICACAO
-- ============================================================================
--   Tres asserções estaticas (o texto da funcao e o ACL) e uma DINAMICA, que
--   executa a exclusao de verdade e a DESFAZ. A dinamica existe porque as
--   estaticas provariam apenas que os nomes mudaram — nao que a funcao roda
--   ate o fim sem 42703. E o mesmo padrao de
--   20260909_faturamento_exclui_amostra_e_retrabalho.sql: o bloco com clausula
--   EXCEPTION estabelece um savepoint proprio, e o RAISE desfaz TUDO o que ele
--   escreveu. Nenhuma nota e perdida por esta migration.

do $verifica$
declare
  v_def       text;
  v_grantees  text[];
  v_ref       text;
  v_resultado jsonb;
  v_antes     integer;
  v_depois    integer;
begin
  v_def := pg_get_functiondef('public.fn_excluir_rascunho_nfe(text)'::regprocedure);

  -- (a) Os tres nomes errados sumiram DO CODIGO.
  --
  --     Procura a ASSINATURA do defeito, nunca a palavra solta: os comentarios
  --     desta funcao explicam o conserto e por isso CITAM os nomes errados, e
  --     pg_get_functiondef devolve comentario junto com codigo. Uma asserção
  --     por palavra derrubaria a migration por causa da propria documentacao.
  if v_def ~* 'v_nota\s*\.\s*numero_nfe' then
    raise exception 'ASSERCAO_A_FALHOU: a funcao ainda LE v_nota.numero_nfe.';
  end if;
  if v_def ~* 'ref_nfe\s*=' then
    raise exception 'ASSERCAO_A_FALHOU: a funcao ainda FILTRA por ref_nfe.';
  end if;

  -- ... e os certos estao la, nos dois DELETEs das filhas.
  if v_def !~* 'notas_fiscais_pagamentos\s+where\s+ref\s*=' then
    raise exception 'ASSERCAO_A_FALHOU: o DELETE de pagamentos nao filtra por ref.';
  end if;
  if v_def !~* 'notas_fiscais_itens\s+where\s+ref\s*=' then
    raise exception 'ASSERCAO_A_FALHOU: o DELETE de itens nao filtra por ref.';
  end if;

  -- (b) Os guardas continuam de pe, todos os cinco campos fiscais e todos os
  --     cinco status aceitos. Se alguem afrouxar isto depois, quebra aqui.
  if v_def !~* 'numero_nf is not null'
     or v_def !~* 'chave_nfe is not null'
     or v_def !~* 'protocolo is not null'
     or v_def !~* 'caminho_xml is not null'
     or v_def !~* 'caminho_danfe is not null' then
    raise exception 'ASSERCAO_B_FALHOU: o guarda de dados fiscais perdeu algum campo.';
  end if;
  if v_def !~* 'RASCUNHO' or v_def !~* 'PENDENTE' or v_def !~* 'ERRO_VALIDACAO'
     or v_def !~* 'ERRO_ENVIO' or v_def !~* 'PRONTA_PARA_ENVIO' then
    raise exception 'ASSERCAO_B_FALHOU: a lista de status aceitos mudou.';
  end if;
  if v_def ~* '''PROCESSANDO''' or v_def ~* '''AUTORIZADA''' or v_def ~* '''ERRO_AUTORIZACAO''' then
    raise exception 'ASSERCAO_B_FALHOU: status que nao pode ser aceito entrou na funcao.';
  end if;

  -- (c) O ACL: nem PUBLIC nem anon. authenticated e service_role presentes.
  select array_agg(distinct (a).grantee::regrole::text)
  into v_grantees
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on true
  where n.nspname = 'public' and p.proname = 'fn_excluir_rascunho_nfe';

  if '-' = any(v_grantees) then
    raise exception 'ASSERCAO_C_FALHOU: PUBLIC ainda executa a funcao. ACL=%', v_grantees;
  end if;
  if 'anon' = any(v_grantees) then
    raise exception 'ASSERCAO_C_FALHOU: anon ainda executa a funcao. ACL=%', v_grantees;
  end if;
  if not ('authenticated' = any(v_grantees)) then
    raise exception 'ASSERCAO_C_FALHOU: authenticated perdeu o EXECUTE. ACL=%', v_grantees;
  end if;
  if not ('service_role' = any(v_grantees)) then
    raise exception 'ASSERCAO_C_FALHOU: service_role perdeu o EXECUTE. ACL=%', v_grantees;
  end if;

  raise notice 'Assercoes A, B e C OK. ACL final: %', v_grantees;

  -- (d) DINAMICA, e desfeita. Exclui de verdade, confere que sumiu com as
  --     filhas, e derruba tudo no RAISE.
  --
  --     O ensaio e feito NA NFE-20370-001, de proposito, e nao numa nota
  --     qualquer: se um dia o desfazer falhar, o estrago sera exatamente o que
  --     o dono ja decidiu fazer com ela. Nenhuma outra nota corre risco.
  --     De quebra, isto PROVA que ela passa nos guardas — que e a pergunta que
  --     precede o descarte.
  begin
    select ref into v_ref
    from public.notas_fiscais
    where ref = 'NFE-20370-001'
      and status in ('RASCUNHO', 'PENDENTE', 'ERRO_VALIDACAO', 'ERRO_ENVIO', 'PRONTA_PARA_ENVIO')
      and numero_nf is null and chave_nfe is null and protocolo is null
      and caminho_xml is null and caminho_danfe is null;

    if v_ref is null then
      raise notice 'Assercao D pulada: NFE-20370-001 nao esta elegivel (ou ja nao existe).';
    else
      select count(*) into v_antes from public.notas_fiscais where ref = v_ref;

      v_resultado := public.fn_excluir_rascunho_nfe(v_ref);

      if coalesce(v_resultado->>'ok', 'false') <> 'true' then
        raise exception 'ASSERCAO_D_FALHOU: a exclusao de % foi recusada: %', v_ref, v_resultado;
      end if;

      select count(*) into v_depois from public.notas_fiscais where ref = v_ref;
      if v_antes <> 1 or v_depois <> 0 then
        raise exception 'ASSERCAO_D_FALHOU: a nota % nao saiu (antes=%, depois=%).', v_ref, v_antes, v_depois;
      end if;

      if exists (select 1 from public.notas_fiscais_itens where ref = v_ref)
         or exists (select 1 from public.notas_fiscais_pagamentos where ref = v_ref) then
        raise exception 'ASSERCAO_D_FALHOU: sobraram filhas de % apos a exclusao.', v_ref;
      end if;

      raise notice 'Assercao D OK: % foi excluida no ensaio, com as filhas, e sera desfeita.', v_ref;
    end if;

    -- Desfaz o ensaio inteiro. O bloco tem EXCEPTION, entao tem savepoint.
    raise exception 'ROLLBACK_ASSERCAO';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_ASSERCAO' then
        raise;
      end if;
  end;

  -- Prova de que o ensaio foi desfeito: a nota escolhida continua la.
  if v_ref is not null then
    if not exists (select 1 from public.notas_fiscais where ref = v_ref) then
      raise exception 'ASSERCAO_E_FALHOU: o ensaio NAO foi desfeito — a nota % sumiu de verdade.', v_ref;
    end if;
    raise notice 'Assercao E OK: % continua no banco. Nenhuma nota foi perdida.', v_ref;
  end if;
end
$verifica$;

-- ============================================================================
-- CONFERENCIA MANUAL (rodar depois, fora da migration)
-- ============================================================================
--   -- 1. O ACL final. Esperado: {authenticated, postgres, service_role}
--   --    Nao pode conter "-" (PUBLIC) nem "anon".
--   select array_agg(distinct (a).grantee::regrole::text) as grantees,
--          p.proacl::text
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on true
--    where n.nspname = 'public' and p.proname = 'fn_excluir_rascunho_nfe'
--    group by p.proacl::text;
--
--   -- 2. Nenhuma nota sumiu. Esperado: 30, e 15 nos status aceitos.
--   select count(*) as total,
--          count(*) filter (where status in ('RASCUNHO','PENDENTE','ERRO_VALIDACAO',
--                                            'ERRO_ENVIO','PRONTA_PARA_ENVIO')) as elegiveis
--     from public.notas_fiscais;
--
--   -- 3. A NFE-20370-002 intocada. Esperado: PROCESSANDO, sem numero e sem chave.
--   select ref, status, numero_nf, chave_nfe from public.notas_fiscais
--    where ref = 'NFE-20370-002';
--
--   -- 4. A recusa continua funcionando numa nota que nao pode ser excluida.
--   --    Esperado: ok=false, erro=NFE_NAO_PODE_SER_EXCLUIDA. NAO apaga nada.
--   select public.fn_excluir_rascunho_nfe('NFE-20370-002');

-- ============================================================================
-- ROLLBACK (comentado, nao executar sem decisao explicita)
-- ============================================================================
--   Voltar atras devolve a funcao ao estado em que ela NUNCA FUNCIONOU — e,
--   se os GRANTs forem refeitos, devolve o EXECUTE ao PUBLIC e ao anon. Nada
--   de dado se perde nos dois casos: a funcao quebrada nunca apagou linha
--   nenhuma. Reverter o ACL sozinho, sem reverter o corpo, e o pior dos
--   mundos: funcao que funciona ao alcance do anon.
--
--   -- corpo anterior (com os tres nomes errados, mantido so como registro):
--   --   v_nota.numero_nfe / notas_fiscais_pagamentos.ref_nfe /
--   --   notas_fiscais_itens.ref_nfe, e sem o guarda de notas_eventos.
--   --   O texto integral esta no git, no commit desta migration.
--
--   -- ACL anterior:
--   -- grant execute on function public.fn_excluir_rascunho_nfe(text) to public;
--   -- grant execute on function public.fn_excluir_rascunho_nfe(text) to anon;
-- ============================================================================
