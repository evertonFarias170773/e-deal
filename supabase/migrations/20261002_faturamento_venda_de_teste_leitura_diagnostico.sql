-- Ajuste da migration 20261002_faturamento_exclui_vendas_de_teste: a função de
-- leitura de diagnóstico volta a conseguir ler a visão de faturamento.
--
-- POR QUE
--   Em visão, a permissão de EXECUTE das funções usadas é conferida contra quem
--   CONSULTA a visão, não contra o dono dela (ao contrário das tabelas). A
--   migration anterior criou public.fn_venda_de_teste com EXECUTE só para
--   authenticated e service_role. O aplicativo seguiu funcionando, mas
--   supabase_read_only_user — a função somente leitura das consultas de
--   diagnóstico — passou a receber "permission denied for function
--   fn_venda_de_teste" ao ler view_pagamentos_pagos_v2, que lia antes.
--
-- O QUE FAZ
--   Um GRANT, e só: EXECUTE em fn_venda_de_teste para supabase_read_only_user.
--   anon continua sem EXECUTE e sem SELECT na visão. Nenhuma definição muda.
GRANT EXECUTE ON FUNCTION public.fn_venda_de_teste(bigint, bigint, text, uuid) TO supabase_read_only_user;

DO $assert$
BEGIN
  IF NOT has_function_privilege('supabase_read_only_user', 'public.fn_venda_de_teste(bigint,bigint,text,uuid)', 'execute') THEN
    RAISE EXCEPTION 'ASSERCAO_FALHOU: supabase_read_only_user segue sem EXECUTE.';
  END IF;
  IF has_function_privilege('anon', 'public.fn_venda_de_teste(bigint,bigint,text,uuid)', 'execute') THEN
    RAISE EXCEPTION 'ASSERCAO_FALHOU: anon ganhou EXECUTE.';
  END IF;
END
$assert$;
