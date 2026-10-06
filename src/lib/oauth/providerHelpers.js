const BASE64_BLOCK_SIZE = 4;

function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding = (BASE64_BLOCK_SIZE - (base64.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE;
    const padded = base64 + "=".repeat(missingPadding);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractEmailFromAccessToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return undefined;
  return payload.email || payload.preferred_username || payload.sub || undefined;
}

export function extractCodexAccountInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return {};
  const chatgpt = payload["https://api.openai.com/auth"] || {};
  return {
    email: payload.email,
    chatgptAccountId: chatgpt.chatgpt_account_id || payload.account_id,
    chatgptPlanType: chatgpt.chatgpt_plan_type || payload.plan_type,
    chatgptSubscriptionActiveUntil: chatgpt.chatgpt_subscription_active_until,
  };
}

export { decodeJwtPayload, extractEmailFromAccessToken };
