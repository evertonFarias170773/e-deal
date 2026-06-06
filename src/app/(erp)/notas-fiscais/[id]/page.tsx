import { NfeDetailPage } from "@/features/nfe/components/NfeDetailPage";

type NfeDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function Page({ params }: NfeDetailRouteProps) {
  const { id } = await params;
  return <NfeDetailPage noteId={id} />;
}
