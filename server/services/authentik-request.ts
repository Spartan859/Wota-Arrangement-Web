type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type SleepLike = (ms: number) => Promise<void>;

type AuthentikRequestOptions = {
  attempts?: number;
  retryDelayMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
};

export function createAuthentikRequest(
  baseUrl: string,
  {
    attempts = 180,
    retryDelayMs = 2_000,
    fetchImpl = fetch,
    sleepImpl = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  }: AuthentikRequestOptions = {},
) {
  const apiBaseUrl = baseUrl.replace(/\/$/, "");

  return async function request<T>(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await fetchImpl(`${apiBaseUrl}/api/v3${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...init.headers,
        },
      });
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const body = await response.text();
      const error = new Error(
        `${init.method ?? "GET"} ${path} failed: ${response.status} ${body}`,
      );
      if (
        response.status === 503 &&
        body.includes("authentik starting") &&
        attempt < attempts - 1
      ) {
        await sleepImpl(retryDelayMs);
        continue;
      }
      throw error;
    }

    throw new Error(`${init.method ?? "GET"} ${path} did not become ready.`);
  };
}
