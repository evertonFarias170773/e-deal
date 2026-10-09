-- =====================================================================================
-- FASE 7, PARTE 1: fechamento automatico de grupo + revogar EXECUTE da funcao do gate
--
-- O QUE E
--   1. REVOKE EXECUTE de public.exp__trg_gate_acompanhar() para authenticated e
--      service_role. E funcao de trigger: so precisa ser executada pelo disparo do
--      trigger, que nao exige EXECUTE de quem grava (a permissao e conferida na criacao
--      do trigger, e ele ja existe).
--   2. public.fechar_grupo_se_concluido(p_id_int bigint) returns integer
--      SECURITY DEFINER, search_path fixo, sem EXECUTE para ninguem alem do dono.
--      Para cada grupo ATIVO (qualquer tipo) em que o pedido esta: se TODOS os membros
--      ativos estao despachados (expedicoes.data_despacho), ENTREGUE, RECEBIDO ou
--      CANCELADO, marca saiu_em = now(), saiu_por = null, saiu_motivo = 'grupo concluído'
--      em todas as linhas ativas do grupo. Enquanto sobrar membro ativo e parado, nao
--      fecha. Idempotente: grupo ja fechado nao tem linha ativa, nada acontece.
--      Devolve quantos grupos fechou.
--   3. Trigger AFTER INSERT OR UPDATE OF data_despacho em public.expedicoes
--      (trg_exp_fechar_grupo, funcao exp__trg_fechar_grupo): quando data_despacho vai de
--      nulo para preenchido, chama a funcao acima NA MESMA TRANSACAO.
--
-- POR QUE
--   Sem fechamento, grupo esquecido ficaria ativo para sempre: o chip continuaria na tela
--   e, em ACOMPANHAR, o gate continuaria olhando para ele.
--
-- ORDEM COM O GATE
--   O gate (trg_exp_gate_acompanhar) e BEFORE: se recusa, a gravacao nao acontece e o
--   AFTER nem dispara. O fechamento e AFTER: roda depois da linha gravada, e por isso ja
--   enxerga o despacho que acabou de acontecer.
--
-- O QUE NAO FAZ
--   NAO bloqueia nem atrasa o despacho: a funcao do trigger engole qualquer erro da
--   chamada (bloco EXCEPTION interno) e so registra um WARNING no log do banco; a
--   gravacao de expedicoes segue. NAO toca em propostas, nem em expedicoes, nem em
--   nenhuma outra funcao ou trigger existente. NAO cria vinculo.
--
-- LIMITE CONHECIDO
--   Dois membros despachados em transacoes simultaneas podem nao enxergar um ao outro
--   (READ COMMITTED) e nenhum fechar; o grupo fica ativo, sem efeito sobre o despacho,
--   e fecha no proximo despacho ou por "soltar".
--
-- VERIFICACAO
--   select tgname from pg_trigger where tgrelid = 'public.expedicoes'::regclass and not tgisinternal;
--     -> trg_exp_fechar_grupo, trg_exp_gate_acompanhar, trg_exp_trava_frete_despacho
--   select has_function_privilege('authenticated', 'public.exp__trg_gate_acompanhar()', 'execute');  -- false
--
-- ROLLBACK
--   drop trigger if exists trg_exp_fechar_grupo on public.expedicoes;
--   drop function if exists public.exp__trg_fechar_grupo();
--   drop function if exists public.fechar_grupo_se_concluido(bigint);
--   grant execute on function public.exp__trg_gate_acompanhar() to authenticated, service_role;
-- =====================================================================================

revoke execute on function public.exp__trg_gate_acompanhar() from authenticated, service_role;

create or replace function public.fechar_grupo_se_concluido(p_id_int bigint)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grupo  uuid;
  v_abertos integer;
  v_fechados integer := 0;
begin
  for v_grupo in
    select distinct v.grupo_id
      from public.pedidos_vinculos v
     where v.id_int = p_id_int and v.saiu_em is null
  loop
    select count(*) into v_abertos
      from public.pedidos_vinculos m
      join public.propostas p on p.id_int = m.id_int
     where m.grupo_id = v_grupo
       and m.saiu_em is null
       and upper(coalesce(p.status_interno, '')) not in ('ENTREGUE', 'RECEBIDO', 'CANCELADO', 'CANCELADA')
       and not exists (select 1 from public.expedicoes e
                        where e.id_int = m.id_int and e.data_despacho is not null);
    if v_abertos = 0 then
      update public.pedidos_vinculos
         set saiu_em = now(), saiu_por = null, saiu_por_nome = null, saiu_motivo = 'grupo concluído'
       where grupo_id = v_grupo and saiu_em is null;
      v_fechados := v_fechados + 1;
    end if;
  end loop;
  return v_fechados;
end;
$$;
revoke all on function public.fechar_grupo_se_concluido(bigint) from public, anon, authenticated, service_role;

create or replace function public.exp__trg_fechar_grupo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.data_despacho is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.data_despacho is not null then
    return NEW;
  end if;
  begin
    perform public.fechar_grupo_se_concluido(NEW.id_int);
  exception when others then
    -- Nunca atrapalha o despacho: registra e segue.
    raise warning 'fechar_grupo_se_concluido(%) falhou: % %', NEW.id_int, sqlstate, sqlerrm;
  end;
  return NEW;
end;
$$;
revoke all on function public.exp__trg_fechar_grupo() from public, anon, authenticated, service_role;

create trigger trg_exp_fechar_grupo
  after insert or update of data_despacho on public.expedicoes
  for each row
  execute function public.exp__trg_fechar_grupo();
