import "server-only";

/**
 * ブラウザからの CSRF（別サイトを開いている間の blind POST）を防ぐ。
 * このアプリはローカル専用で、POST が GitHub のレート制限や Jev の課金を
 * 直接消費するため、同一オリジン以外からの状態変更リクエストを拒否する。
 *
 * `Origin` ヘッダが無いリクエスト（curl 等、ブラウザ以外からの直接呼び出し）は許可する。
 * ブラウザはクロスオリジンの POST に必ず `Origin` を付けるため、これで実用上のブラウザ CSRF は防げる。
 */
export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin) {
    return Response.json({ error: "許可されていないオリジンからのリクエストです" }, { status: 403 });
  }
  return null;
}
