-- Migration: Limpar órfãos de pedidos_modelos e criar FK em cascata
-- Data: 2026-06-27

-- 1. Consulta de Auditoria (Para conferência manual)
-- SELECT id, id_int, id_produto_proposta_origem 
-- FROM public.pedidos_modelos pm
-- WHERE pm.id_produto_proposta_origem IS NOT NULL 
--   AND NOT EXISTS (
--     SELECT 1 FROM public.produtos_proposta pp 
--     WHERE pp.id = pm.id_produto_proposta_origem
--   );

-- 2. Limpeza dos registros órfãos
DELETE FROM public.pedidos_modelos pm
WHERE pm.id_produto_proposta_origem IS NOT NULL 
  AND NOT EXISTS (
    SELECT 1 FROM public.produtos_proposta pp 
    WHERE pp.id = pm.id_produto_proposta_origem
  );

-- 3. Adicionar Constraint de Chave Estrangeira (ON DELETE CASCADE)
ALTER TABLE public.pedidos_modelos
ADD CONSTRAINT fk_pedidos_modelos_produtos_proposta
FOREIGN KEY (id_produto_proposta_origem)
REFERENCES public.produtos_proposta(id)
ON DELETE CASCADE;
