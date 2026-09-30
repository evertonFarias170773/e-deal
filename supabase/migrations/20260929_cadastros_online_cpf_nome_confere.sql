-- cadastros_online.cpf_nome_confere: sinal da conferencia do nome pela CPFHub
--
-- Pedido do dono em 29/09/2026: cadastro com CPF enviado pelo link publico
-- (/c/<token>) passa a nascer PENDENTE na fila, e o vendedor aprova. No envio,
-- depois do honeypot, do limite e da duplicidade, o servidor consulta a CPFHub
-- e grava aqui SO se o nome digitado confere com o nome do CPF:
--
--   true   nome confere
--   false  nome nao confere
--   null   nao verificado (CPFHub fora do ar, sem credito, CPF nao encontrado,
--          ou cadastro de CNPJ — que nao passa pela CPFHub)
--
-- O nome que a CPFHub devolve NUNCA e gravado nem mostrado: so o sinal. A
-- pagina publica tambem nao o recebe — responde igual nos dois casos.
--
-- Aditiva: coluna nula, sem default, sem reescrita da tabela. `authenticated`
-- ja tem SELECT e UPDATE de tabela em cadastros_online (migration de 07/09),
-- entao a coluna nova entra nesses grants sem GRANT novo; a fila le o sinal
-- pela sessao do atendente. O formulario publico continua sem grant nenhum:
-- quem grava e a rota, com service_role.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'cadastros_online' and column_name = 'cpf_nome_confere'
  ) then
    raise exception 'ABORTADO: cadastros_online.cpf_nome_confere ja existe.';
  end if;
end $$;

alter table public.cadastros_online
  add column cpf_nome_confere boolean;

comment on column public.cadastros_online.cpf_nome_confere is
  'Conferencia do nome pela CPFHub no envio publico: true confere, false nao confere, null nao verificado (CNPJ, CPF nao encontrado ou API indisponivel). O nome da CPFHub nao e gravado.';

do $$
declare
  v_tipo text;
  v_grants text;
begin
  select data_type into v_tipo from information_schema.columns
   where table_schema = 'public' and table_name = 'cadastros_online' and column_name = 'cpf_nome_confere';
  if v_tipo is distinct from 'boolean' then
    raise exception 'FALHOU: coluna nao criada como boolean (%).', v_tipo;
  end if;

  select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || x.privilege_type, ', ' order by coalesce(r.rolname, 'PUBLIC'), x.privilege_type)
    into v_grants
    from pg_class c, aclexplode(c.relacl) x left join pg_roles r on r.oid = x.grantee
   where c.oid = 'public.cadastros_online'::regclass;
  if v_grants not like '%authenticated=SELECT%' or v_grants not like '%authenticated=UPDATE%' or v_grants like '%anon=%' then
    raise exception 'FALHOU: grants de cadastros_online fora do esperado: %', v_grants;
  end if;

  raise notice 'cadastros_online.cpf_nome_confere criada. Grants: %', v_grants;
end $$;

-- ROLLBACK (manual):
--   alter table public.cadastros_online drop column cpf_nome_confere;
