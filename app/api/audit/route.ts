import { getRepo } from "@/lib/queries";
import { scoreRepo } from "@/lib/score";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner")?.trim() ?? "";
  const repo = searchParams.get("repo")?.trim() ?? "";

  const repoRow = getRepo(owner, repo);
  if (!repoRow) {
    return Response.json({ error: "このリポジトリはまだ取り込まれていません" }, { status: 404 });
  }

  const result = scoreRepo(repoRow.id);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
