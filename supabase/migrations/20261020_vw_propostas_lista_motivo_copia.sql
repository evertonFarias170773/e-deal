-- ============================================================================
-- 20261020_vw_propostas_lista_motivo_copia — a lista de Pedidos le o motivo da copia
-- 20/10/2026 — decisao do dono.
--
-- POR QUE: `vw_propostas_lista` (20260926_lista_pedidos_status_alterado_em) foi
--   criada com `p.*`, que o Postgres congela na criacao: `propostas.motivo_copia`
--   (19/10) nao chega a lista. O destaque de retrabalho (src/lib/retrabalho.ts)
--   passa a considerar o motivo, e a lista precisa dele NA MESMA consulta.
--
-- O QUE MUDA: so `motivo_copia` como ULTIMA coluna. As 64 colunas de hoje, a ordem,
--   o FROM, o LEFT JOIN, `status_alterado_em` e security_invoker ficam iguais
--   (a lista abaixo e a expansao viva do `p.*`, conferida em 20/10/2026).
--   `obs_entrega` e `is_sistema_antigo` (tambem posteriores ao p.*) NAO entram:
--   fora do pedido.
-- CREATE OR REPLACE VIEW mantem dono, ACL e comentario. O WITH precisa ser
--   repetido: sem ele o REPLACE zera as opcoes da view.
-- DEPENDENTES: nenhuma view nem funcao; no app, so a lista de Pedidos
--   (orcamentos.service.ts, fetchPropostaRows).
--
-- ROLLBACK: no rodape (a definicao anterior, sem a coluna). Remover coluna de view
--   exige DROP + CREATE; o rodape faz isso e devolve o ACL e o comentario de hoje.
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_propostas_lista
WITH (security_invoker = true) AS
 SELECT
    p.id,
    p.user_id,
    p.cliente,
    p.proposta,
    p.valor,
    p.vendedor,
    p.id_conversa,
    p.created_at,
    p.updated_at,
    p.peso,
    p.id_int,
    p.id_vendedor,
    p."cnpjCpf",
    p.prop_reduz,
    p.frete_escolhido,
    p.status_interno,
    p.json_produtos,
    p.empresa,
    p.volume,
    p.valor_total,
    p.conferencia,
    p.conferido_por,
    p.id_cliente,
    p.id_frete,
    p.contato,
    p.id_endereco_ent,
    p.texto_whatsapp,
    p.is_copia,
    p.id_int_origem_copia,
    p.tem_veppo,
    p.credito_processado,
    p.obs_proposta,
    p."PDF",
    p.tipo_cob_edeal,
    p.tipo_boleto_edeal,
    p.is_avulso,
    p.id_faturado,
    p.boleto_aproved,
    p.motivo_reproved,
    p.is_reproved,
    p.cep,
    p.id_cupincha,
    p.valor_frete,
    p.status_pedido,
    p.etapa_operacional,
    p.prioridade_operacional,
    p.prazo_operacional,
    p.obs_pedido,
    p.id_contato,
    p.em_arte,
    p.is_prd_aprovado,
    p.libera_nf,
    p.modalidade_frete,
    p.id_transportadora_cliente,
    p.encerrado_teste_em,
    p.encerrado_teste_por,
    p.transporte_categoria,
    p.obs_tecnica,
    p.liberado_producao_em,
    p.categoria_frete,
    p.id_int_pedido_principal,
    p.faturado_fora_em,
    p.faturado_fora_por,
    COALESCE(s.status_alterado_em, p.created_at) AS status_alterado_em,
    p.motivo_copia
   FROM public.propostas p
     LEFT JOIN public.propostas_status_alterado s ON s.id_int = p.id_int;

-- ============================================================================
-- ROLLBACK — tire o comentario de bloco e rode.
-- ============================================================================
/*
DROP VIEW public.vw_propostas_lista;

CREATE VIEW public.vw_propostas_lista
WITH (security_invoker = true) AS
 SELECT
    p.id,
    p.user_id,
    p.cliente,
    p.proposta,
    p.valor,
    p.vendedor,
    p.id_conversa,
    p.created_at,
    p.updated_at,
    p.peso,
    p.id_int,
    p.id_vendedor,
    p."cnpjCpf",
    p.prop_reduz,
    p.frete_escolhido,
    p.status_interno,
    p.json_produtos,
    p.empresa,
    p.volume,
    p.valor_total,
    p.conferencia,
    p.conferido_por,
    p.id_cliente,
    p.id_frete,
    p.contato,
    p.id_endereco_ent,
    p.texto_whatsapp,
    p.is_copia,
    p.id_int_origem_copia,
    p.tem_veppo,
    p.credito_processado,
    p.obs_proposta,
    p."PDF",
    p.tipo_cob_edeal,
    p.tipo_boleto_edeal,
    p.is_avulso,
    p.id_faturado,
    p.boleto_aproved,
    p.motivo_reproved,
    p.is_reproved,
    p.cep,
    p.id_cupincha,
    p.valor_frete,
    p.status_pedido,
    p.etapa_operacional,
    p.prioridade_operacional,
    p.prazo_operacional,
    p.obs_pedido,
    p.id_contato,
    p.em_arte,
    p.is_prd_aprovado,
    p.libera_nf,
    p.modalidade_frete,
    p.id_transportadora_cliente,
    p.encerrado_teste_em,
    p.encerrado_teste_por,
    p.transporte_categoria,
    p.obs_tecnica,
    p.liberado_producao_em,
    p.categoria_frete,
    p.id_int_pedido_principal,
    p.faturado_fora_em,
    p.faturado_fora_por,
    COALESCE(s.status_alterado_em, p.created_at) AS status_alterado_em
   FROM public.propostas p
     LEFT JOIN public.propostas_status_alterado s ON s.id_int = p.id_int;

COMMENT ON VIEW public.vw_propostas_lista IS
  'Lista de Pedidos: propostas + status_alterado_em (ultima mudanca real de status_interno; sem historico, created_at). security_invoker: vale a RLS de propostas. Colunas de propostas congeladas na criacao da view (p.*).';

REVOKE ALL ON public.vw_propostas_lista FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_propostas_lista TO authenticated;
GRANT ALL ON public.vw_propostas_lista TO service_role;
*/
