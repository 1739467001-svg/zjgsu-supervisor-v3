import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  // Express 只在已信任的代理来源下解析 forwarded proto，不能直接相信客户端请求头。
  return false;
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const isSecure = isSecureRequest(req);

  return {
    httpOnly: true,
    path: "/",
    // SameSite=None 要求必须同时 Secure=true，否则现代浏览器会拒绝写入 cookie。
    // 在 HTTP（非 HTTPS）环境（如通过 IP 地址访问）下，使用 SameSite=Lax + Secure=false，
    // 确保登录后 session cookie 能被浏览器正常保存和发送。
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  };
}
