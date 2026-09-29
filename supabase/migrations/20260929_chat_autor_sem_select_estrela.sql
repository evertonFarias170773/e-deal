-- ============================================================================
-- tg_preencher_autor_propostas_chat: sem `select *` em public.usuarios
-- 29/09/2026, decisao do dono — autorizacao nominal SO para esta migration.
--
-- POR QUE
--   O SELECT de public.usuarios passa a ser por coluna (migration seguinte,
--   20260929_usuarios_select_por_coluna): cod_confirma, telefone, documento,
--   "cpfCnpj" e cus_asaas saem do alcance de authenticated. Este trigger e
--   SECURITY INVOKER e fazia `select * into v_usuario` — pediria as colunas
--   fechadas e todo INSERT em propostas_chat com autor_uid daria 42501.
--
-- O QUE MUDA (so isto; o resto e o corpo vivo, byte a byte, CRLF incluso)
--   - `v_usuario public.usuarios%rowtype;`  ->  `v_usuario record;`
--   - `select *`  ->  `select avatar, nome_usuario, email, setor`
--   md5(prosrc): antes 996bc6a8dc96875b02b5dd45a48bf39a
--                depois d98d481232ebf927be2e413d254a1981
--   O bloco parte do prosrc VIVO, confere o md5 de entrada e cada troca tem de
--   acontecer exatamente uma vez; qualquer divergencia aborta sem alterar nada.
--   CREATE OR REPLACE mantem dono, ACL e o trigger trg_preencher_autor_propostas_chat.
-- ============================================================================

do $migracao$
declare
  v_corpo text;
  v_novo  text;
  c_decl_velha constant text := 'v_usuario public.usuarios%rowtype;';
  c_decl_nova  constant text := 'v_usuario record;';
  c_sel_velho  constant text := E'select *\r\n    into v_usuario';
  c_sel_novo   constant text := E'select avatar, nome_usuario, email, setor\r\n    into v_usuario';
begin
  select p.prosrc into v_corpo
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'tg_preencher_autor_propostas_chat';

  if md5(v_corpo) <> '996bc6a8dc96875b02b5dd45a48bf39a' then
    raise exception 'corpo vivo mudou: md5 %', md5(v_corpo);
  end if;
  if (length(v_corpo) - length(replace(v_corpo, c_decl_velha, ''))) / length(c_decl_velha) <> 1
     or (length(v_corpo) - length(replace(v_corpo, c_sel_velho, ''))) / length(c_sel_velho) <> 1 then
    raise exception 'trechos a trocar nao aparecem exatamente uma vez';
  end if;

  v_novo := replace(replace(v_corpo, c_decl_velha, c_decl_nova), c_sel_velho, c_sel_novo);

  if md5(v_novo) <> 'd98d481232ebf927be2e413d254a1981' then
    raise exception 'md5 do corpo novo inesperado: %', md5(v_novo);
  end if;

  execute format(
    'create or replace function public.tg_preencher_autor_propostas_chat() returns trigger language plpgsql as %L',
    v_novo
  );
end
$migracao$;
