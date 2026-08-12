-- Escopo da Conta Corrente: passa a ser a PROPOSTA, nao a lotacao do vendedor
--
-- PROBLEMA
--   Duas checagens diferentes barravam o E-Credito comparando a empresa do
--   USUARIO com uma empresa do PAGAMENTO/PROPOSTA:
--
--     a) pgv2_registrar_chave_idempotencia, com um pino inline:
--          usuarios.id_empresa <> pagamentos_v2.id_empresa -> 42501
--     b) cc__assert_escopo_empresa:
--          usuarios.id_empresa <> cc__id_empresa_proposta(id_int) -> 42501
--
--   A premissa das duas esta errada. A empresa recebedora e uma ESCOLHA
--   COMERCIAL feita no modal de cobranca; a proposta tambem pode ser de
--   outra empresa. Nada disso tem relacao com onde o vendedor esta lotado.
--
-- MEDIDO EM PRODUCAO (12/08/2026)
--   Fabio Almeida (usuarios.id_empresa = 3) tentou QUATRO vezes aplicar o
--   credito de R$ 156,82 do cliente 65863 nas propostas #20520, #20536,
--   #20541 e #20543 — todas da Ideal Grafica (empresa 1) e todas com ele
--   como VENDEDOR. As quatro barradas.
--
--   E nao e caso de borda; e a regra da casa:
--     Emily Boeira    (empresa 2): 531 de 533 cobrancas para outra empresa
--     Alexandre Almeida (empresa 2): 163 de 588
--     Fabio Almeida   (empresa 3):  94 de 494
--     Lisiane Colbeich (id_empresa NULL): 16 de 16 — NULL barra sempre
--
-- POR QUE NAO BASTAVA TROCAR (a) POR (b)
--   Foi a primeira hipotese e ela falha: (b) compara a empresa do usuario
--   com a empresa da PROPOSTA — para o Fabio da 3 contra 1 e nega igual. O
--   erro so mudaria de lugar, reaparecendo em mc_usar_credito_avulso, que ja
--   chama (b). Por isso a correcao e na REGRA, nao no ponto de chamada.
--
-- REGRA NOVA (a mesma que o ERP ja aplica, e que osqr__assert_escopo ja
-- implementa em SQL):
--   '*' ou 'propostas.view_all'            -> passa
--   'propostas.view_company'               -> exige mesma empresa da proposta
--   'propostas.view_team'/'propostas.view_own' -> exige SER o vendedor
--   nada disso                             -> nega 42501
--
--   NAO afrouxa: quem nao tem escopo na proposta continua barrado, e nenhum
--   perfil ganhou permissao. O criterio deixa de ser "onde o vendedor esta
--   lotado" e passa a ser "esta proposta e dele". Perfis hoje: Super Admin
--   ('*'), Administrador e Financeiro (view_all) passam como antes; Vendedor
--   (view_own) passa nas proprias propostas; Producao, Designer, Operador e
--   Acesso Pendente continuam sem escopo — e sem 'credito.usar'.
--
-- DUAS DIFERENCAS DELIBERADAS EM RELACAO A osqr__assert_escopo
--   1. view_company compara por ID normalizado via cc__id_empresa_proposta,
--      nao por texto. `propostas.empresa` guarda "Ideal Grafica" e
--      "IDEAL GRÁFICA EXPRESSA EIRELI" para a MESMA empresa; a comparacao
--      textual de osqr__assert_escopo nao casa esses dois.
--   2. Os ramos sao avaliados como alternativas (OR), sem `raise` dentro do
--      ramo de view_company. Em osqr__assert_escopo, quem tem view_company E
--      view_own e barrado numa proposta de outra empresa mesmo sendo o
--      vendedor dela. Aqui, basta UM dos escopos conceder.

CREATE OR REPLACE FUNCTION public.cc__assert_escopo_empresa(p_uid uuid, p_id_int bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_usuario record;
  v_perms jsonb;
  v_proposta record;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH: usuário não autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT is_super_adm, id_empresa, id_perfil, nome_usuario
    INTO v_usuario
    FROM public.usuarios WHERE user_id = p_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUTH: usuário sem cadastro em public.usuarios' USING ERRCODE = '28000';
  END IF;
  IF COALESCE(v_usuario.is_super_adm, false) THEN RETURN; END IF;

  IF v_usuario.id_perfil IS NOT NULL THEN
    SELECT permissoes INTO v_perms
      FROM public.perfis WHERE id = v_usuario.id_perfil AND ativo = true;
  END IF;
  v_perms := COALESCE(v_perms, '[]'::jsonb);

  IF v_perms ? '*' OR v_perms ? 'propostas.view_all' THEN RETURN; END IF;

  SELECT empresa, vendedor INTO v_proposta
    FROM public.propostas WHERE id_int = p_id_int;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CC_PROPOSTA: proposta #% não encontrada', p_id_int USING ERRCODE = 'P0002';
  END IF;

  IF v_perms ? 'propostas.view_company'
     AND v_usuario.id_empresa IS NOT NULL
     AND public.cc__id_empresa_proposta(p_id_int) = v_usuario.id_empresa THEN
    RETURN;
  END IF;

  IF (v_perms ? 'propostas.view_team' OR v_perms ? 'propostas.view_own')
     AND v_proposta.vendedor IS NOT NULL
     AND v_usuario.nome_usuario IS NOT NULL
     AND lower(public.unaccent(btrim(v_proposta.vendedor)))
       = lower(public.unaccent(btrim(v_usuario.nome_usuario))) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'PERM: proposta #% fora do escopo do usuário', p_id_int USING ERRCODE = '42501';
END; $function$;

-- pgv2_registrar_chave_idempotencia: troca o pino inline de empresa pela
-- checagem acima. Passa a usar v_pag.id_int (a proposta do pagamento) — o
-- mesmo argumento que cc_usar_pendencia e mc_usar_credito_avulso ja usam.
-- Todas as demais guardas ficam iguais: permissao credito.usar, parametros
-- obrigatorios, pagamento inexistente, pagamento cancelado e chave ja
-- registrada.
CREATE OR REPLACE FUNCTION public.pgv2_registrar_chave_idempotencia(p_id_pagamento uuid, p_chave_idempotencia uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pag public.pagamentos_v2%ROWTYPE;
BEGIN
  PERFORM public.cc__assert_permissao(v_uid, 'credito.usar');
  IF p_id_pagamento IS NULL OR p_chave_idempotencia IS NULL THEN
    RAISE EXCEPTION 'MC_PARAMS: id_pagamento e chave_idempotencia são obrigatórios';
  END IF;

  SELECT * INTO v_pag FROM public.pagamentos_v2 WHERE id = p_id_pagamento FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MC_PAGAMENTO: pagamento % não encontrado', p_id_pagamento;
  END IF;
  IF v_pag.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'MC_CANCELADO: pagamento % está cancelado', p_id_pagamento;
  END IF;

  PERFORM public.cc__assert_escopo_empresa(v_uid, v_pag.id_int);

  IF v_pag.chave_idempotencia IS NOT NULL THEN
    RAISE EXCEPTION 'MC_IDEMPOTENCIA: pagamento % já possui chave', p_id_pagamento;
  END IF;

  UPDATE public.pagamentos_v2
     SET chave_idempotencia = p_chave_idempotencia
   WHERE id = p_id_pagamento;
END; $function$;
