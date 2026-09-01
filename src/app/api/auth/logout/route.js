import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearAllAuthCookies } from "@/mine/auth/rememberMe";

export async function POST() {
  const cookieStore = await cookies();
  clearAllAuthCookies(cookieStore);
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
