-- ROLLBACK de 20261124_auditoria_notas_fiscais_pagamentos (NAO APLICADO).
-- Desliga a auditoria de notas_fiscais_pagamentos: tira o gatilho e a linha de
-- audit.config_v2. As linhas ja gravadas em audit.logs_v2 ficam. Rodar so com
-- ordem do dono.
do $volta$
begin
  set local lock_timeout = '5s';
  drop trigger if exists trg_audit_notas_fiscais_pagamentos on public.notas_fiscais_pagamentos;
  delete from audit.config_v2 where schema_name = 'public' and table_name = 'notas_fiscais_pagamentos';
  raise notice 'auditoria desligada em notas_fiscais_pagamentos';
end
$volta$;
