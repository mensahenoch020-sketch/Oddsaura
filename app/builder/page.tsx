import { redirect } from "next/navigation";

type BuilderSearchParams = {
  fixture?: string | string[];
  slip?: string | string[];
};

export default async function BuilderPage({ searchParams }: { searchParams: Promise<BuilderSearchParams> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (typeof params.fixture === "string" && params.fixture) query.set("fixture", params.fixture);
  if (typeof params.slip === "string" && params.slip) query.set("slip", params.slip);
  redirect(query.size ? `/dashboard?${query.toString()}` : "/dashboard");
}
