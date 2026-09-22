import "server-only";

export function getTypesafeApiKey(): string | null {
  return process.env.TYPESAFE_API_KEY || null;
}

export function hasTypesafeApiKey(): boolean {
  return !!getTypesafeApiKey();
}

export function isJevDisabled(): boolean {
  return process.env.JEV_DISABLED === "1";
}

export function getGithubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

export function hasGithubToken(): boolean {
  return !!getGithubToken();
}

/** ローカルの llama.cpp サーバー（OpenAI 互換）。外部送信ではなく、既定は 127.0.0.1 固定。 */
export function getGemmaEndpoint(): string {
  return process.env.GEMMA_ENDPOINT || "http://127.0.0.1:8080/v1/chat/completions";
}

export function getGemmaModel(): string {
  return process.env.GEMMA_MODEL || "gemma-4-12b-it-Q4_K_M.gguf";
}

export function isGemmaDisabled(): boolean {
  return process.env.GEMMA_DISABLED === "1";
}
