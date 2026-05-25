import type { LucideIcon } from "lucide-react";
import { SummaryCard } from "@/components/common/SummaryCard";
import type { StatusTone } from "@/lib/types";

type CobrancaResumoCardProps = {
  title: string;
  value: string;
  description: string;
  tone: StatusTone;
  icon: LucideIcon;
};

export function CobrancaResumoCard(props: CobrancaResumoCardProps) {
  return <SummaryCard {...props} />;
}
