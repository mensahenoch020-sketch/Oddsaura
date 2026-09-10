import AssistantClient from "../assistant/assistant-client";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  const params = await searchParams;
  const request = typeof params.request === "string" ? params.request.trim() : "";
  return <AssistantClient initialRequest={request} />;
}
