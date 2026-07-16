import { clearSessionCookie } from "../../../lib/auth/server";
import { json } from "../_shared";

export async function POST(request: Request) {
  return json({ signedOut: true }, 200, { "set-cookie": clearSessionCookie(request) });
}
