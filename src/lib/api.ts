export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public problems: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('No internet connection. Check your mobile data and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/me' && path !== '/login') window.dispatchEvent(new Event('tj:signed-out'));
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.problems ?? []);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Fetch a stored photo/signature as bytes (used for reports). */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(`Could not load ${path}`, res.status);
  return res.blob();
}

export const photoUrl = (id: number) => `/api/photos/${id}`;
export const signatureUrl = (visitId: number, who: 'auditor' | 'manager') => `/api/visits/${visitId}/signature/${who}`;
