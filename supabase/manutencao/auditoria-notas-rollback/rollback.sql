-- ROLLBACK de 20261116_auditoria_notas_fiscais_eventos (NAO APLICADO).
-- Desliga a auditoria de notas_fiscais e notas_eventos: tira os dois gatilhos
-- e as duas linhas de audit.config_v2. As linhas ja gravadas em audit.logs_v2
-- ficam. Rodar so com ordem do dono.
do $volta$
begin
  set local lock_timeout = '5s';
  drop trigger if exists trg_audit_notas_fiscais on public.notas_fiscais;
  drop trigger if exists trg_audit_notas_eventos on public.notas_eventos;
  delete from audit.config_v2 where schema_name = 'public' and table_name in ('notas_fiscais', 'notas_eventos');
  raise notice 'auditoria desligada em notas_fiscais e notas_eventos';
end
$volta$;
