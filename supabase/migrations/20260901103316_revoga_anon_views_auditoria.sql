-- =============================================================================
-- 20260901103316_revoga_anon_views_auditoria.sql
--
-- O QUE
--   Revoga TODOS os privilegios dos roles `anon` e `authenticated` nas quatro
--   views de auditoria do schema public:
--     public.vw_audit_logs          (legada, sobre audit.logs)
--     public.vw_audit_logs_v2       (sobre audit.logs_v2)
--     public.vw_audit_logs_v2_admin (sobre audit.logs_v2, com old_data/new_data)
--     public.vw_audit_logs_v2_lista (projecao da _admin)
--
-- POR QUE (levantamento de 01/09/2026, somente leitura)
--   1. As quatro views nasceram com o ACL padrao do schema public
--      (`anon=arwdDxtm`, `authenticated=arwdDxtm`) e executam COMO O DONO
--      (`postgres`, sem `security_invoker`). Resultado: uma requisicao
--      anonima ao PostgREST, sem login, lia a trilha inteira — 330.719
--      registros em 01/09/2026 (264k de clientes, 60k de propostas, 5,6k de
--      boletos, 116 de usuarios) — mesmo sem nenhum grant em audit.logs_v2
--      e sem USAGE no schema audit.
--   2. As views sao AUTO-ATUALIZAVEIS (information_schema.views.is_updatable
--      = YES) e `arwdDxtm` inclui INSERT, UPDATE e DELETE. Como a view
--      atravessa com os privilegios do dono, o `anon` podia inserir, alterar
--      ou apagar linhas da propria trilha de auditoria pela view.
--   3. Colunas pessoais alcancaveis pelo anon (old_data/new_data da _admin;
--      changed_fields com valores old/new da _v2; cliente/vendedor/ator da
--      _lista):
--        clientes : documento, email, email_contato, email_financeiro,
--                   whatsapp_1, whatsapp_2, telefone_fixo, limite_credito,
--                   credito, risco_credito, obs
--        usuarios : cpfCnpj, documento, email, telefone, cod_confirma,
--                   cus_asaas, user_id, is_super_adm, id_perfil
--        todas    : actor_email (e-mail do funcionario que fez a alteracao)
--
-- CONSUMIDORES CONFERIDOS (nenhum depende do grant de anon/authenticated)
--   - src/            : nenhuma leitura das views (apenas comentarios).
--   - n8n             : 89 workflows lidos pela API — nenhuma referencia.
--   - Maestro         : nao le as views.
--   - public.rpc_dashboard_executivo: le vw_audit_logs_v2, mas e SECURITY
--     DEFINER com dono postgres — segue funcionando; so precisa de EXECUTE,
--     que nao muda.
--   - Triggers/funcoes de status leem audit.logs_v2 direto, nao pela view.
--
-- FORA DESTE BLOCO (decisoes separadas): public.token_inter (depende da
--   conferencia da credencial do n8n), default privileges do schema public,
--   security_invoker nas views, qualquer outra tabela ou view.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ASSERCOES DE ENTRADA: as quatro views existem e o anon tem SELECT hoje
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
begin
  foreach v in array array[
    'public.vw_audit_logs',
    'public.vw_audit_logs_v2',
    'public.vw_audit_logs_v2_admin',
    'public.vw_audit_logs_v2_lista'
  ] loop
    if to_regclass(v) is null then
      raise exception 'ASSERCAO DE ENTRADA: view % nao existe', v;
    end if;
    if not has_table_privilege('anon', v, 'SELECT') then
      raise exception 'ASSERCAO DE ENTRADA: anon NAO tem SELECT em % — estado diferente do levantado; abortando', v;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- REVOKE
-- ---------------------------------------------------------------------------
revoke all on
  public.vw_audit_logs,
  public.vw_audit_logs_v2,
  public.vw_audit_logs_v2_admin,
  public.vw_audit_logs_v2_lista
from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ASSERCOES DE SAIDA: anon/authenticated sem privilegio algum;
-- service_role e postgres inalterados (continuam com ALL)
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
  r text;
  p text;
begin
  foreach v in array array[
    'public.vw_audit_logs',
    'public.vw_audit_logs_v2',
    'public.vw_audit_logs_v2_admin',
    'public.vw_audit_logs_v2_lista'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        if has_table_privilege(r, v, p) then
          raise exception 'ASSERCAO DE SAIDA: % ainda tem % em %', r, p, v;
        end if;
      end loop;
    end loop;
    foreach r in array array['service_role', 'postgres'] loop
      foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        if not has_table_privilege(r, v, p) then
          raise exception 'ASSERCAO DE SAIDA: % PERDEU % em % — o revoke alcancou mais do que devia', r, p, v;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (manual, comentado) — reabre exatamente o que foi fechado
-- ---------------------------------------------------------------------------
-- grant all on
--   public.vw_audit_logs,
--   public.vw_audit_logs_v2,
--   public.vw_audit_logs_v2_admin,
--   public.vw_audit_logs_v2_lista
-- to anon, authenticated;
