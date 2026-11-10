-- =====================================================================
-- Reversao da trava compartilhada ChatGuru (Vibe + Imposition) - revisao 4
--
-- Mesmo texto do rodape de CHATGURU-TRAVA-COMPARTILHADA-MIGRACAO.sql, pronto
-- para rodar. So com autorizacao nominal e com os envios dos dois lados
-- pausados (roteiro: docs/technical/CHATGURU-TRAVA-JANELA.md, Volta).
--
-- Rodar o arquivo INTEIRO numa execucao do SQL Editor. Sem BEGIN e sem COMMIT
-- de proposito: o editor roda tudo numa transacao implicita; se qualquer
-- comando falhar (inclusive a drenagem da primeira linha), nada fica feito e
-- nenhuma transacao fica aberta.
--
-- As tres RPCs do Imposition voltam da copia chatguru_trava_rpcs_originais,
-- guardada pela migracao antes de alterar (parte 0b), e nao de texto escrito aqui.
--
-- Antes: guardar uma copia de chatguru_trava_registro (Exportar CSV no editor:
-- select * from public.chatguru_trava_registro order by id), que e apagada aqui.
-- =====================================================================

select public.chatguru_trava_drenagem(true);  -- aborta se houver envio em andamento
-- solta as travas do Vibe (a chave estrangeira volta e não aceita 'vibe:')
update public.imposition_whatsapp_conversas set chave_envio = null, atualizado_em = now()
 where chave_envio like 'vibe:%';
drop trigger imposition_whatsapp_conversas_dono on public.imposition_whatsapp_conversas;
drop trigger expedicao_aviso_pronto_trava_nao_apagar on public.expedicao_aviso_pronto;
drop trigger imposition_whatsapp_artes_trava_nao_apagar on public.imposition_whatsapp_artes;
drop function public.imposition_whatsapp_conversas_dono_existe();
drop function public.imposition_whatsapp_trava_nao_apagar();
drop function public.imposition_whatsapp_conversa_travar(text, text);
drop function public.imposition_whatsapp_conversa_soltar(text, text, boolean);

-- RPCs do Imposition: voltam da copia guardada pela migracao (parte 0b):
-- definicao, dono e permissoes, cada uma conferida contra a copia (md5 do corpo
-- e da definicao). So depois a copia e apagada. O texto original nao passa por
-- este arquivo.
do $rpcs$
declare r record; g record; v_n int;
begin
  select count(*) into v_n from public.chatguru_trava_rpcs_originais;
  if v_n <> 3 then
    raise exception 'Reversao abortada: copia das RPCs do Imposition com % de 3 linhas', v_n using errcode = '55000';
  end if;
  for r in select * from public.chatguru_trava_rpcs_originais order by proname loop
    execute r.definicao;
    if (select pg_get_userbyid(proowner) from pg_proc where oid = r.assinatura::regprocedure) <> r.dono then
      execute format('alter function %s owner to %I', r.assinatura, r.dono);
    end if;
    if (select proacl from pg_proc where oid = r.assinatura::regprocedure) is distinct from r.permissoes and r.permissoes is not null then
      execute format('revoke all on function %s from public', r.assinatura);
      for g in select distinct a.grantee from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = r.assinatura::regprocedure and a.grantee <> 0 loop
        execute format('revoke all on function %s from %I', r.assinatura, pg_get_userbyid(g.grantee));
      end loop;
      for g in select a.grantee, a.privilege_type, a.is_grantable
                 from aclexplode(r.permissoes) with ordinality as a(grantor, grantee, privilege_type, is_grantable, ord) order by a.ord loop
        execute format('grant %s on function %s to %s%s', g.privilege_type, r.assinatura,
                       case when g.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end,
                       case when g.is_grantable then ' with grant option' else '' end);
      end loop;
    end if;
    if not exists (select 1 from pg_proc p where p.oid = r.assinatura::regprocedure
                     and md5(p.prosrc) = r.md5_corpo and md5(pg_get_functiondef(p.oid)) = r.md5_definicao
                     and pg_get_userbyid(p.proowner) = r.dono and p.proacl is not distinct from r.permissoes) then
      raise exception 'Reversao abortada: % nao voltou igual a copia guardada pela migracao', r.proname using errcode = '55000';
    end if;
  end loop;
end $rpcs$;
drop table public.chatguru_trava_rpcs_originais;
drop index public.imposition_whatsapp_conversas_chave_envio;
alter table public.imposition_whatsapp_conversas drop column livre_em;
alter table public.imposition_whatsapp_conversas drop constraint imposition_whatsapp_conversas_chave_envio_check;
alter table public.imposition_whatsapp_conversas
  add constraint imposition_whatsapp_conversas_chave_envio_fkey
  foreign key (chave_envio) references public.imposition_whatsapp_artes(chave);
drop view public.chatguru_trava_conferencia;
drop function public.chatguru_trava_margem();
drop table public.chatguru_trava_registro;   -- guardar uma cópia antes, se já tiver linhas
drop table public.chatguru_trava_config;
drop function public.chatguru_trava_drenagem(boolean);
