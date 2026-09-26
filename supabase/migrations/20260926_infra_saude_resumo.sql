-- =====================================================================
-- infra_saude_resumo(): numeros do banco e do storage para a secao
-- "Saude da infraestrutura" do Dashboard (so admin)
-- =====================================================================
--
-- O QUE
-- -----
-- Uma funcao que so LE e devolve um jsonb:
--   banco      tamanho total, acerto de cache das tabelas
--   historico  audit.logs_v2 por mes (tamanho de cada particao) e total
--   storage    por bucket: arquivos, bytes e bytes criados nos ultimos 30 dias
--
-- QUEM CHAMA
-- ----------
-- So a rota /api/admin/infra-saude, no servidor, com a service role, depois de
-- conferir que o usuario e admin. EXECUTE fica so com service_role: nada de
-- PUBLIC, anon ou authenticated (toda funcao nova em public nasce com EXECUTE
-- para PUBLIC, entao o REVOKE e explicito).
--
-- POR QUE SECURITY DEFINER
-- ------------------------
-- Le storage.objects e as particoes do schema audit, que a service_role nao
-- enxerga por grant. search_path fixo; nenhuma escrita.

CREATE OR REPLACE FUNCTION public.infra_saude_resumo()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'banco', jsonb_build_object(
      'bytes', pg_database_size(current_database()),
      'cache_hit_pct', (
        SELECT round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit + heap_blks_read), 0), 2)
        FROM pg_statio_user_tables
      )
    ),
    'historico', (
      SELECT jsonb_build_object(
        'total_bytes', coalesce(sum(pg_total_relation_size(c.oid)), 0),
        'meses', coalesce(
          jsonb_agg(
            jsonb_build_object(
              'mes', replace(substring(c.relname FROM 9), '_', '-'),
              'bytes', pg_total_relation_size(c.oid)
            ) ORDER BY c.relname
          ) FILTER (
            WHERE c.relname ~ '^logs_v2_[0-9]{4}_[0-9]{2}$'
              AND to_date(substring(c.relname FROM 9), 'YYYY_MM') <= current_date
              AND to_date(substring(c.relname FROM 9), 'YYYY_MM') > current_date - interval '12 months'
          ),
          '[]'::jsonb
        )
      )
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname = 'audit' AND p.relname = 'logs_v2'
    ),
    'storage', (
      SELECT jsonb_build_object(
        'total_bytes', coalesce(sum(b.bytes), 0),
        'total_arquivos', coalesce(sum(b.arquivos), 0),
        'bytes_30d', coalesce(sum(b.bytes_30d), 0),
        'buckets', coalesce(
          jsonb_agg(
            jsonb_build_object(
              'bucket', b.bucket_id,
              'publico', b.publico,
              'arquivos', b.arquivos,
              'bytes', b.bytes,
              'bytes_30d', b.bytes_30d
            ) ORDER BY b.bytes DESC
          ),
          '[]'::jsonb
        )
      )
      FROM (
        SELECT o.bucket_id,
               bool_or(bk.public) AS publico,
               count(*) AS arquivos,
               coalesce(sum((o.metadata->>'size')::bigint), 0) AS bytes,
               coalesce(sum((o.metadata->>'size')::bigint) FILTER (WHERE o.created_at > now() - interval '30 days'), 0) AS bytes_30d
        FROM storage.objects o
        LEFT JOIN storage.buckets bk ON bk.id = o.bucket_id
        GROUP BY o.bucket_id
      ) b
    )
  );
$$;

REVOKE ALL ON FUNCTION public.infra_saude_resumo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.infra_saude_resumo() FROM anon;
REVOKE ALL ON FUNCTION public.infra_saude_resumo() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.infra_saude_resumo() TO service_role;
