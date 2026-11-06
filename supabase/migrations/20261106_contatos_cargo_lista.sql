-- Cargo do contato vira lista fechada: "Comprador", "Financeiro" ou vazio (06/11/2026).
--
-- 1. Cópia do cargo atual de cada contato com cargo preenchido, para poder voltar:
--    public.contatos_cargo_backup_20261106 (id_contato, cargo_antigo).
-- 2. Conversão: contém "financeiro" (sem maiúscula nem acento) -> Financeiro;
--    qualquer outro cargo preenchido -> Comprador; nulo ou só espaços fica como está.
-- 3. Regra no banco: só aceita Comprador, Financeiro ou vazio.
--
-- TRAVA: só aplica se Financeiro + Comprador = total de cargos preenchidos e a
-- cópia tiver exatamente esse total. Senão aborta e nada é gravado.
-- Só a coluna `cargo` muda: nome, WhatsApp, e-mail, ativo e id_cliente ficam intactos.
--
-- Para voltar:
--   alter table public.contatos drop constraint contatos_cargo_lista;
--   update public.contatos c set cargo = b.cargo_antigo
--     from public.contatos_cargo_backup_20261106 b where b.id_contato = c.id;

create table if not exists public.contatos_cargo_backup_20261106 (
  id_contato bigint primary key,
  cargo_antigo text not null,
  copiado_em timestamptz not null default now()
);

comment on table public.contatos_cargo_backup_20261106 is
  'Cópia do contatos.cargo antes da lista fechada (migration 20261106_contatos_cargo_lista). Só para desfazer.';

-- Cópia de uso interno: fora do alcance da API.
alter table public.contatos_cargo_backup_20261106 enable row level security;
revoke all on public.contatos_cargo_backup_20261106 from anon, authenticated;

do $$
declare
  v_preenchidos int;
  v_financeiro int;
  v_comprador int;
  v_copiados int;
begin
  select
    count(*) filter (where nullif(btrim(cargo), '') is not null),
    count(*) filter (where nullif(btrim(cargo), '') is not null and unaccent(lower(cargo)) like '%financeiro%'),
    count(*) filter (where nullif(btrim(cargo), '') is not null and unaccent(lower(cargo)) not like '%financeiro%')
  into v_preenchidos, v_financeiro, v_comprador
  from public.contatos;

  if v_financeiro + v_comprador <> v_preenchidos then
    raise exception 'TRAVA: Financeiro (%) + Comprador (%) <> preenchidos (%). Nada gravado.', v_financeiro, v_comprador, v_preenchidos;
  end if;

  insert into public.contatos_cargo_backup_20261106 (id_contato, cargo_antigo)
  select id, cargo from public.contatos where nullif(btrim(cargo), '') is not null
  on conflict (id_contato) do nothing;

  select count(*) into v_copiados
  from public.contatos_cargo_backup_20261106 b
  join public.contatos c on c.id = b.id_contato and c.cargo = b.cargo_antigo;

  if v_copiados <> v_preenchidos then
    raise exception 'TRAVA: cópia com % linhas, esperado %. Nada gravado.', v_copiados, v_preenchidos;
  end if;

  update public.contatos
     set cargo = case when unaccent(lower(cargo)) like '%financeiro%' then 'Financeiro' else 'Comprador' end
   where nullif(btrim(cargo), '') is not null
     and cargo is distinct from (case when unaccent(lower(cargo)) like '%financeiro%' then 'Financeiro' else 'Comprador' end);

  raise notice 'Financeiro: %, Comprador: %, preenchidos: %, copiados: %', v_financeiro, v_comprador, v_preenchidos, v_copiados;
end $$;

alter table public.contatos
  add constraint contatos_cargo_lista
  check (cargo is null or btrim(cargo) = '' or cargo in ('Comprador', 'Financeiro'));

comment on column public.contatos.cargo is
  'Lista fechada: Comprador, Financeiro ou vazio (lib/cargo-contato). Cópia dos valores antigos em contatos_cargo_backup_20261106.';
