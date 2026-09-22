import { listRepos } from "@/lib/queries";

export async function GET() {
  return Response.json({ repos: listRepos() }, { headers: { "Cache-Control": "no-store" } });
}
