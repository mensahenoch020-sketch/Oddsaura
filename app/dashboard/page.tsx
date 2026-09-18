import AssistantClient from "../assistant/assistant-client";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ request?: string | string[]; tool?: string | string[] }> }) {
  const params = await searchParams;
  const request = typeof params.request === "string" ? params.request.trim() : "";
  const initialTool = params.tool === "converter" ? "converter" : "ask";
  return <AssistantClient initialRequest={request} initialTool={initialTool} />;
}
