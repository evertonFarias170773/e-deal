"""Le um PDF de etiqueta e imprime em JSON, por pagina, as linhas de texto (texto, caixa, corpo, fonte). Usa o pymupdf."""
import json, sys
try:
    import pymupdf as fitz
except ImportError:
    import fitz

def analisar(caminho):
    doc = fitz.open(caminho)
    paginas = []
    for pagina in doc:
        linhas = []
        for bloco in pagina.get_text("dict")["blocks"]:
            for linha in bloco.get("lines", []):
                spans = linha["spans"]
                if not spans:
                    continue
                x0, y0, x1, y1 = linha["bbox"]
                linhas.append({
                    "texto": "".join(s["text"] for s in spans),
                    "x0": round(x0, 1), "y0": round(y0, 1), "x1": round(x1, 1), "y1": round(y1, 1),
                    "base": round(spans[0]["origin"][1], 1), "corpo": round(spans[0]["size"], 1), "fonte": spans[0]["font"],
                })
        linhas.sort(key=lambda l: (l["y0"], l["x0"], l["texto"]))
        paginas.append(linhas)
    return paginas

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(analisar(sys.argv[1]), ensure_ascii=False))
