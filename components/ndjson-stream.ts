/**
 * NDJSON ストリーム（`/api/ingest` / `/api/classify` / `/api/advise` が返す
 * `application/x-ndjson`）を1行ずつ読んで onLine に渡す。ingest-form.tsx から
 * 切り出したもの（3つ目の呼び出し元が出るため）。
 *
 * lib/ には置かない ── lib 配下は全ファイル `import "server-only"` という
 * 不変条件があり、これはブラウザの fetch/TextDecoderStream を使うクライアント専用コード。
 */
export async function streamNdjson(url: string, body: unknown, onLine: (obj: Record<string, unknown>) => void): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onLine(JSON.parse(line) as Record<string, unknown>);
    }
  }
  if (buffer.trim()) onLine(JSON.parse(buffer) as Record<string, unknown>);
}
