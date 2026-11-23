import { BaseExecutor } from "./base.js";
import { refreshClaudeToken } from "../services/tokenRefresh/providers.js";
import { PROVIDERS } from "../config/providers.js";

export class ClaudeExecutor extends BaseExecutor {
  constructor() { super("claude", PROVIDERS.claude); }
  refreshCredentials(credentials, log, proxyOptions) { return refreshClaudeToken(credentials?.refreshToken, log, proxyOptions); }
  transformRequest(model, body, stream) { return { ...body, stream }; }
  buildUrl() { return `${this.config.baseUrl}${this.config.urlSuffix || ""}`; }
}
