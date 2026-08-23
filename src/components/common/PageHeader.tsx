import type { ReactNode } from "react";

type PageHeaderProps = {
  /**
   * Texto simples na maioria das telas. Aceita ReactNode porque a edicao de
   * pedido compoe o titulo em duas partes com espacamento proprio (numero em
   * destaque, cliente depois) — e isso e estilo, nao caractere no meio da
   * string. Alargar o tipo e retrocompativel: toda string continua valida e
   * nenhuma outra tela muda.
   */
  title: ReactNode;
  /**
   * Opcional: há cabeçalho em que o título já diz tudo (a edição de pedido, que
   * identifica pedido e cliente) e a linha de apoio só ocuparia espaço.
   */
  subtitle?: string;
  context?: string;
  action?: ReactNode;
};

export function PageHeader({ title, subtitle, context, action }: PageHeaderProps) {
  return (
    <div
      className="flex flex-col gap-4 rounded-2xl p-5 shadow-md lg:flex-row lg:items-center lg:justify-between"
      style={{
        background: "var(--primary)",
        border: "1px solid color-mix(in srgb, var(--primary) 80%, black)"
      }}
    >
      <div>
        {context ? (
          <span
            className="mb-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{
              background: "color-mix(in srgb, var(--primary-foreground) 15%, transparent)",
              color: "color-mix(in srgb, var(--primary-foreground) 90%, transparent)"
            }}
          >
            {context}
          </span>
        ) : null}
        <h1
          className="text-2xl font-bold tracking-tight md:text-3xl"
          style={{ color: "var(--primary-foreground)" }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            className="mt-2 max-w-3xl text-sm leading-6"
            style={{ color: "color-mix(in srgb, var(--primary-foreground) 78%, transparent)" }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
