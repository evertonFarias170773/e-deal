-- Conta Corrente: empresa e autoria da proposta deixam de barrar o crédito
--
-- SUBSTITUI a regra introduzida em 20260812_escopo_conta_corrente_por_proposta.sql,
-- no mesmo dia. Aquela versao trocou o pino de empresa por "tem de ser o
-- vendedor da proposta". Estava errado tambem.
--
-- REGRA DE NEGOCIO (informada pelo dono do produto em 12/08/2026):
--   Os vendedores sao do GRUPO, formado pelas 3 empresas. Existe uma divisao
--   estrategica — vendedor X fecha na empresa X — mas ela NAO e absoluta.
--   Vendedor X gerar cobranca para a empresa Z e normal e nao tem
--   importancia. Empresa nao e fronteira de seguranca.
--
-- POR QUE TAMBEM CAIU A EXIGENCIA DE SER O VENDEDOR
--   Ela nao existe em nenhuma outra modalidade: criar PIX, boleto, cartao ou
--   faturado em proposta de outro vendedor nao passa por checagem alguma
--   (gerar-pix so le id_empresa para escolher as credenciais do banco).
--   Exigir isso apenas no credito era inconsistente e barraria casos reais —
--   medidos 2 nos ultimos 30 dias, feitos por vendedores em proposta de
--   colega.
--
-- O QUE CONTINUA CONTROLANDO DE VERDADE
--   * cc__assert_permissao(uid, 'credito.usar') — o portao real. Producao,
--     Designer, Operador e Acesso Pendente nao tem essa permissao e seguem
--     barrados antes de chegar aqui.
--   * CC_CLIENTE_DIVERGENTE — o pagamento tem de ser do cliente informado.
--   * CC_PROPOSTA_DIVERGENTE — tem de ser da proposta de destino informada.
--   * CC_EMPRESA_DIVERGENTE — a empresa do pagamento tem de bater com a da
--     proposta (coerencia interna do registro, nao escopo de usuario).
--   * CC_SALDO_INSUFICIENTE, trava de linha do cliente e recalculo do saldo
--     sob trava.
--   * Chave de idempotencia, indice unico.
--
-- O QUE ESTA FUNCAO FAZ AGORA
--   Sanidade, so: exige usuario autenticado, com cadastro em public.usuarios,
--   e proposta existente. O nome foi mantido porque ha 10 pontos de chamada;
--   renomear seria churn sem ganho.

CREATE OR REPLACE FUNCTION public.cc__assert_escopo_empresa(p_uid uuid, p_id_int bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existe boolean;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH: usuário não autenticado' USING ERRCODE = '28000';
  END IF;

  PERFORM 1 FROM public.usuarios WHERE user_id = p_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUTH: usuário sem cadastro em public.usuarios' USING ERRCODE = '28000';
  END IF;

  SELECT true INTO v_existe FROM public.propostas WHERE id_int = p_id_int;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CC_PROPOSTA: proposta #% não encontrada', p_id_int USING ERRCODE = 'P0002';
  END IF;
END; $function$;
