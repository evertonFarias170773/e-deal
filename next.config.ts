import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // O Maestro lê o manual de uso (docs/manual/*.md) em tempo de execução, para
  // montar o índice e devolver a página pedida. A pasta é listada com readdir,
  // que o rastreador de arquivos do build não acompanha: sem esta linha os .md
  // não entram na função da Vercel e o Maestro fica sem manual em produção.
  outputFileTracingIncludes: {
    "/api/maestro/simple": ["./docs/manual/*.md"],
  },
  async headers() {
    return [
      {
        // Página pública do QR de produção: sem indexação, sem referrer, sem cache.
        source: "/os",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        // Cadastro online. `no-referrer` é mais importante aqui do que em /os:
        // ali o token sai da URL logo após a carga, aqui ele É o caminho
        // (/c/<token>) e sairia no Referer de qualquer link que a página abrisse.
        source: "/c/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        // Área do cliente (/p/<token>): mesma regra do /c — o token É o
        // caminho, e o único link para fora (checkout do cartão) abre sem
        // referrer para o token não viajar junto.
        source: "/p/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        // Aviso de privacidade: aberto pelo formulário, e por isso também sem
        // referrer — senão o token do link do atendente viajaria até aqui.
        source: "/privacidade",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
