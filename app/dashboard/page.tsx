import AssistantClient from "../assistant/assistant-client";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ request?: string | string[]; tool?: string | string[]; fixture?: string | string[]; slip?: string | string[] }> }) {
  const params = await searchParams;
  const request = typeof params.request === "string" ? params.request.trim() : "";
  const initialTool = params.tool === "converter" ? "converter" : "ask";
  const initialFixtureId = typeof params.fixture === "string" ? params.fixture : "";
  const initialSlip = typeof params.slip === "string" ? params.slip : "";
  return <AssistantClient initialRequest={request} initialTool={initialTool} initialFixtureId={initialFixtureId} initialSlip={initialSlip} />;
}
