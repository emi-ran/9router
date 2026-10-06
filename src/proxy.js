import { proxy as dashboardProxy } from "./dashboardGuard";

export default dashboardProxy;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
