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
