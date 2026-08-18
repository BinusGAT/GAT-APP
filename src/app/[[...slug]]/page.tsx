import { getAppBootstrapData } from "@/lib/actions";
import GatAppClient from "@/components/GatAppClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function GatAppPage({ params }: PageProps) {
  const { slug } = await params;
  const initialData = await getAppBootstrapData();

  return <GatAppClient slug={slug} initialData={initialData} />;
}
