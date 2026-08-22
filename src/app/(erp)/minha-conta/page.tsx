"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { ShieldCheck, User, ShieldAlert, Award, FileText } from "lucide-react";

export default function MinhaContaPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-lg" style={{ color: "var(--muted)" }}>
          Carregando dados da conta...
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-6 px-4">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
          Minha Conta
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Informações de perfil e privilégios de acesso do usuário.
        </p>
      </div>

      {/* Alerta de Homologação */}
      <div
        className="rounded-2xl border p-4 flex gap-3 items-start"
        style={{
          borderColor: "#f59e0b",
          background: "color-mix(in srgb, #f59e0b 8%, transparent)",
        }}
      >
        <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-sm" style={{ color: "#b45309" }}>
            Área de Diagnóstico e Homologação
          </h3>
          <p className="text-xs mt-1" style={{ color: "#78350f" }}>
            Esta tela é temporária e mostra o perfil e as permissões carregadas para a sua conta.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Card de Identificação */}
        <div
          className="md:col-span-1 rounded-2xl border p-5 space-y-4 shadow-sm"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="flex flex-col items-center text-center space-y-2">
            <span
              className="flex h-16 w-16 items-center justify-center rounded-2xl shadow-inner"
              style={{
                background: "color-mix(in srgb, var(--primary) 10%, transparent)",
                color: "var(--primary)"
              }}
            >
              <User className="h-8 w-8" />
            </span>
            <div>
              <h2 className="font-bold text-lg" style={{ color: "var(--foreground)" }}>
                {user.name}
              </h2>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {user.email}
              </p>
            </div>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{
                background: "color-mix(in srgb, var(--secondary) 15%, transparent)",
                color: "var(--secondary)"
              }}
            >
              <Award className="h-3.5 w-3.5" />
              {user.perfilSlug || "Sem Perfil Ativo"}
            </span>
          </div>

          <hr style={{ borderColor: "var(--border)" }} />

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span style={{ color: "var(--muted)" }}>Setor:</span>
              <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                {user.sector}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "var(--muted)" }}>Empresa ID:</span>
              <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                {user.companyId}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: "var(--muted)" }}>ID do Perfil (FK):</span>
              <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                {user.id_perfil ?? "null (cai no fallback)"}
              </span>
            </div>
          </div>
        </div>

        {/* Card de Flags Legadas & Fallback */}
        <div
          className="md:col-span-2 rounded-2xl border p-5 space-y-4 shadow-sm"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <h3 className="font-bold text-sm flex items-center gap-2" style={{ color: "var(--foreground)" }}>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Estado de Resolução de Privilégios (Fallback Legado)
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--background)" }}>
              <p className="text-xs" style={{ color: "var(--muted)" }}>is_super_adm</p>
              <p className="text-sm font-bold mt-1" style={{ color: user.isSuperAdmin ? "var(--success, #10b981)" : "var(--muted)" }}>
                {user.isSuperAdmin ? "Sim (super_admin)" : "Não"}
              </p>
            </div>
            <div className="p-3 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--background)" }}>
              <p className="text-xs" style={{ color: "var(--muted)" }}>is_admin</p>
              <p className="text-sm font-bold mt-1" style={{ color: user.isAdmin ? "var(--success, #10b981)" : "var(--muted)" }}>
                {user.isAdmin ? "Sim (admin)" : "Não"}
              </p>
            </div>
            <div className="p-3 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--background)" }}>
              <p className="text-xs" style={{ color: "var(--muted)" }}>is_vendedor</p>
              <p className="text-sm font-bold mt-1" style={{ color: user.isSeller ? "var(--success, #10b981)" : "var(--muted)" }}>
                {user.isSeller ? "Sim (vendedor)" : "Não"}
              </p>
            </div>
            <div className="p-3 rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--background)" }}>
              <p className="text-xs" style={{ color: "var(--muted)" }}>Método de Resolução</p>
              <p className="text-sm font-bold mt-1" style={{ color: "var(--primary)" }}>
                {user.id_perfil ? "Banco (Catálogo perfis)" : "Local (Fallback legados)"}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Lista de Permissões Ativas ({user.permissoes?.length ?? 0})
            </h4>
            {user.permissoes && user.permissoes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
                {user.permissoes.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-mono border"
                    style={{
                      background: p === "*" ? "color-mix(in srgb, var(--primary) 10%, transparent)" : "var(--background)",
                      borderColor: p === "*" ? "var(--primary)" : "var(--border)",
                      color: p === "*" ? "var(--primary)" : "var(--foreground)"
                    }}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    {p}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs italic" style={{ color: "var(--muted)" }}>
                Nenhuma permissão associada.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
