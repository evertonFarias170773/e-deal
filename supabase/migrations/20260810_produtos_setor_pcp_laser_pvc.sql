-- Setor PCP do cadastro de produtos: IMPRESSAO -> LASER e PVP -> PVC.
--
-- O CHECK antigo (check_setor_pcp) travava exatamente os quatro valores
-- anteriores, entao ele cai, os dados existentes migram e o CHECK volta com a
-- lista nova. A forma "setor_pcp = ANY (ARRAY[...])" e mantida de proposito:
-- com setor_pcp nulo a expressao e NULL e o CHECK passa, preservando os
-- produtos que ainda nao tem setor definido.
--
-- Aplicada em producao em 10/08/2026 — versao 20260810223939 registrada em
-- supabase_migrations.schema_migrations (nome produtos_setor_pcp_laser_pvc).

alter table public.produtos drop constraint if exists check_setor_pcp;

update public.produtos set setor_pcp = 'LASER' where setor_pcp = 'IMPRESSÃO';
update public.produtos set setor_pcp = 'PVC'   where setor_pcp = 'PVP';

alter table public.produtos
  add constraint check_setor_pcp
  check (setor_pcp = any (array['LASER'::text, 'TEXTIL'::text, 'PVC'::text, 'FLEXO'::text]));
