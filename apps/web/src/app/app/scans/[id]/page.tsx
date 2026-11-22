import { ScanInspector } from "@/components/scan-inspector";

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScanInspector scanId={id} />;
}
