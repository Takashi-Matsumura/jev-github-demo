import { hasGithubToken, hasTypesafeApiKey, isJevDisabled, getGemmaEndpoint, getGemmaModel, isGemmaDisabled } from "@/lib/env";
import { gemmaReachable } from "@/lib/gemma";
import { getDb, tableNames } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const tables = tableNames();
  const prCount = (
    db.prepare("SELECT COUNT(*) AS n FROM pull_requests").get() as { n: number }
  ).n;

  return Response.json(
    {
      github: {
        hasToken: hasGithubToken(),
        transport: hasGithubToken() ? "graphql" : "rest",
        note: hasGithubToken()
          ? "GraphQL 経由・5,000 req/h"
          : "REST 経由・60 req/h・取得件数は最新15件までに制限されます",
      },
      jev: {
        hasApiKey: hasTypesafeApiKey(),
        disabled: isJevDisabled(),
      },
      gemma: {
        endpoint: getGemmaEndpoint(),
        model: getGemmaModel(),
        disabled: isGemmaDisabled(),
        reachable: await gemmaReachable(),
      },
      db: {
        tables,
        pullRequestCount: prCount,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
