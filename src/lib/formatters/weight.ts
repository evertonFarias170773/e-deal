type WeightFormatOptions = {
  mode?: "auto" | "g" | "kg";
  kgFractionDigits?: number;
};

function normalizeGrams(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value;
}

export function gramsToKg(grams: number) {
  return normalizeGrams(grams) / 1000;
}

export function formatWeightFromGrams(grams: number, options: WeightFormatOptions = {}) {
  const normalized = normalizeGrams(grams);
  const mode = options.mode ?? "auto";

  if (mode === "g" || (mode === "auto" && Math.abs(normalized) < 1000)) {
    return `${normalized.toLocaleString("pt-BR")} g`;
  }

  const kg = gramsToKg(normalized);
  const fractionDigits = options.kgFractionDigits ?? 2;
  const formattedKg = kg.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  });

  return `${formattedKg} kg`;
}
