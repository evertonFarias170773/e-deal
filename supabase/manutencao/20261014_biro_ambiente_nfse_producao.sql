-- ============================================================================
-- Ideal Biro (empresas id 2): NFS-e passa de homologacao para PRODUCAO
-- ============================================================================
-- APLICADO EM 14/10/2026, com autorizacao nominal do dono, so este UPDATE.
--
-- Efeito: a proxima NFS-e da Biro reservada pelo Vibe (fn_reservar_emissao_nfse
-- le empresas.ambiente_nfse) nasce com ambiente "producao", e o n8n
-- (hGSiQMKxGxO8trmG) desvia para api.focusnfe.com.br com a credencial
-- "2 - focus Biro" so quando o texto e exatamente "producao".
-- Primeira nota real prevista: pedido 23733. NFS-e so cancela pelo portal nacional.
--
-- Travas: so altera se o valor atual ainda for "homologacao", o pedido 23733
-- nao pode ter NFS-e, e tem de afetar exatamente 1 linha; o resto da linha
-- (fora ambiente_nfse e updated_at) tem de ficar igual.
-- ============================================================================

do $virada$
declare
  v_n        int;
  v_resto_a  text;
  v_resto_d  text;
begin
  if (select ambiente_nfse from public.empresas where id = 2) is distinct from 'homologacao' then
    raise exception 'ambiente_nfse da empresa 2 nao e "homologacao": nada foi gravado';
  end if;
  if exists (select 1 from public.notas_servico where id_int = 23733) then
    raise exception 'o pedido 23733 ja tem NFS-e: nada foi gravado';
  end if;

  select md5((to_jsonb(e) - 'ambiente_nfse' - 'updated_at' - 'dados_agrupados')::text) into v_resto_a
    from public.empresas e where id = 2;

  update public.empresas
     set ambiente_nfse = 'producao'
   where id = 2
     and ambiente_nfse = 'homologacao';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'esperava 1 linha, afetou %: desfeito', v_n;
  end if;

  select md5((to_jsonb(e) - 'ambiente_nfse' - 'updated_at' - 'dados_agrupados')::text) into v_resto_d
    from public.empresas e where id = 2;
  if v_resto_d is distinct from v_resto_a then
    raise exception 'outra coluna da empresa 2 mudou: desfeito';
  end if;

  raise notice 'ok: empresa 2 com ambiente_nfse = producao';
end
$virada$;

-- ============================================================================
-- VOLTA (NAO APLICADA). Rodar so com ordem do dono.
-- ============================================================================
-- do $volta$
-- declare v_n int;
-- begin
--   update public.empresas
--      set ambiente_nfse = 'homologacao'
--    where id = 2
--      and ambiente_nfse = 'producao';
--   get diagnostics v_n = row_count;
--   if v_n <> 1 then
--     raise exception 'esperava 1 linha, afetou %: desfeito', v_n;
--   end if;
--   raise notice 'ok: empresa 2 de volta a homologacao';
-- end
-- $volta$;
-- Atencao: a volta nao muda notas ja reservadas; cada nota guarda o proprio
-- `notas_servico.ambiente`, e e ele que o n8n le.
