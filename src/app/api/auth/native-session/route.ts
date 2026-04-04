const pending = new Map<string, { access_token: string; refresh_token: string; expires: number }>();

function cleanup() {
  const now = Date.now();
  for (const [key, val] of pending) {
    if (val.expires < now) pending.delete(key);
  }
}

export async function POST(request: Request) {
  cleanup();
  const { state, access_token, refresh_token } = await request.json();
  if (!state || !access_token || !refresh_token) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }
  pending.set(state, {
    access_token,
    refresh_token,
    expires: Date.now() + 60_000,
  });
  return Response.json({ ok: true });
}

export async function GET(request: Request) {
  cleanup();
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");
  if (!state) {
    return Response.json({ error: "missing state" }, { status: 400 });
  }
  const entry = pending.get(state);
  if (!entry || entry.expires < Date.now()) {
    return Response.json({ error: "not found or expired" }, { status: 404 });
  }
  pending.delete(state);
  return Response.json({
    access_token: entry.access_token,
    refresh_token: entry.refresh_token,
  });
}
