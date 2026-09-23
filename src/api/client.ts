import {
  adminUserPageSchema,
  publicShareSchema,
  sessionSchema,
  shareSummarySchema,
  type AdminUserPage,
  type PublicShare,
  type SessionState,
  type ShareSnapshot,
  type ShareSummary,
} from "../core/share";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : null;
  if (!response.ok) {
    const payload = body as { code?: string; message?: string } | null;
    throw new ApiError(
      response.status,
      payload?.code ?? "request_failed",
      payload?.message ?? `请求失败（${response.status}）。`,
    );
  }
  return body as T;
}

export async function fetchSession(): Promise<SessionState> {
  return sessionSchema.parse(await apiFetch<unknown>("/api/session"));
}

export async function fetchShares(): Promise<ShareSummary[]> {
  const result = await apiFetch<{ shares: unknown[] }>("/api/shares");
  return result.shares.map((share) => shareSummarySchema.parse(share));
}

export async function fetchPublicShare(token: string): Promise<PublicShare> {
  return publicShareSchema.parse(
    await apiFetch<unknown>(`/api/public/shares/${encodeURIComponent(token)}`),
  );
}

export async function deleteShare(id: string, csrfToken: string) {
  await apiFetch<void>(`/api/shares/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-csrf-token": csrfToken },
  });
}

export async function deleteShareAudio(id: string, csrfToken: string) {
  await apiFetch<void>(`/api/shares/${encodeURIComponent(id)}/audio`, {
    method: "DELETE",
    headers: { "x-csrf-token": csrfToken },
  });
}

export function uploadShare(
  input: {
    projectId: string;
    shareId?: string;
    snapshot: ShareSnapshot;
    audio?: { blob: Blob; name: string };
    preserveAudio: boolean;
  },
  csrfToken: string,
  onProgress: (percent: number) => void,
): Promise<ShareSummary> {
  const form = new FormData();
  form.set("projectId", input.projectId);
  if (input.shareId) form.set("shareId", input.shareId);
  form.set("snapshot", JSON.stringify(input.snapshot));
  form.set("preserveAudio", input.preserveAudio ? "true" : "false");
  if (input.audio) form.set("audio", input.audio.blob, input.audio.name);
  return uploadForm(
    "/api/shares",
    form,
    csrfToken,
    onProgress,
    shareSummarySchema,
  );
}

export function uploadShareAudio(
  shareId: string,
  audio: { blob: Blob; name: string },
  csrfToken: string,
  onProgress: (percent: number) => void,
): Promise<ShareSummary> {
  const form = new FormData();
  form.set("audio", audio.blob, audio.name);
  return uploadForm(
    `/api/shares/${encodeURIComponent(shareId)}/audio`,
    form,
    csrfToken,
    onProgress,
    shareSummarySchema,
  );
}

export async function fetchAdminUsers(
  page: number,
  search: string,
): Promise<AdminUserPage> {
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (search) query.set("search", search);
  return adminUserPageSchema.parse(
    await apiFetch<unknown>(`/api/admin/users?${query}`),
  );
}

export async function fetchAdminUserShares(
  userId: string,
): Promise<ShareSummary[]> {
  const result = await apiFetch<{ shares: unknown[] }>(
    `/api/admin/users/${encodeURIComponent(userId)}/shares`,
  );
  return result.shares.map((share) => shareSummarySchema.parse(share));
}

export async function updateUserQuota(
  userId: string,
  quotaMiB: number,
  csrfToken: string,
) {
  await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/quota`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ quotaMiB }),
  });
}

export async function addAdmin(
  input: { email: string; name: string },
  csrfToken: string,
) {
  await apiFetch("/api/admin/admins", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(input),
  });
}

export async function adminDeleteShare(id: string, csrfToken: string) {
  await apiFetch<void>(`/api/admin/shares/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-csrf-token": csrfToken },
  });
}

export async function adminDeleteShareAudio(id: string, csrfToken: string) {
  await apiFetch<void>(`/api/admin/shares/${encodeURIComponent(id)}/audio`, {
    method: "DELETE",
    headers: { "x-csrf-token": csrfToken },
  });
}

function uploadForm<T>(
  path: string,
  form: FormData,
  csrfToken: string,
  onProgress: (percent: number) => void,
  schema: { parse(value: unknown): T },
) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-csrf-token", csrfToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(new ApiError(0, "network_error", "网络连接失败。"));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(schema.parse(body));
        } catch (error) {
          reject(error);
        }
        return;
      }
      const payload = body as { code?: string; message?: string } | null;
      reject(
        new ApiError(
          xhr.status,
          payload?.code ?? "upload_failed",
          payload?.message ?? `上传失败（${xhr.status}）。`,
        ),
      );
    };
    xhr.send(form);
  });
}
