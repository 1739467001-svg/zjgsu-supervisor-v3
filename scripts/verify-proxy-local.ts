/** 真实nginx/TLS/生产构建演练。只建新虚构库；仅本机端口；不访问云服务器。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import mysql from "mysql2/promise";
import { hashPassword } from "../server/passwords";
import { validateRelease } from "./release-update.mjs";

const [releaseRoot, revision, nginxArg, nodeArg] = process.argv.slice(2);
const prefix = path.resolve("tmp/acceptance/nginx-rehearsal/runtime");
const nginx = path.resolve(nginxArg ?? ""), node = path.resolve(nodeArg ?? process.execPath);
assert(releaseRoot?.includes("/tmp/acceptance/") && /^[a-f0-9]{40}$/.test(revision ?? ""), "仅允许本地已冻结构建");
assert(nginx.includes("/tmp/acceptance/"), "仅允许本地隔离nginx，不操作系统服务");
const release = await validateRelease(releaseRoot, path.join(releaseRoot, "releases", revision));
for (const port of [3108, 8088, 9448]) {
  const probe = net.createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", () => probe.close(() => resolve())); });
}
const suffix = randomBytes(5).toString("hex"), database = `zjgsu_proxy_test_${suffix}`, account = `proxy_${suffix}`;
const databasePassword = randomBytes(32).toString("hex"), loginPassword = randomBytes(24).toString("hex");
const root = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root" });
let app: ChildProcess | undefined, proxy: ChildProcess | undefined, passed = 0;
const check = (condition: unknown, label: string) => { assert(condition, label); passed++; console.log(`通过：${label}`); };
await fs.mkdir(path.join(prefix, "certs"), { recursive: true, mode: 0o700 });
const cert = path.join(prefix, "certs/local-only.pem"), key = path.join(prefix, "certs/local-only.key");
const certificate = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
assert.equal(certificate.status, 0, "本地专用测试证书生成失败");
await fs.chmod(key, 0o600);
const ca = await fs.readFile(cert);
function request(url: string, options: { body?: string; headers?: Record<string, string>; maxVersion?: "TLSv1.1" } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const target = new URL(url), client = target.protocol === "https:" ? https : http;
    const req = client.request(target, { method: options.body ? "POST" : "GET", ca, minVersion: options.maxVersion ? "TLSv1" : "TLSv1.2", maxVersion: options.maxVersion, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }, timeout: 5000 }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", chunk => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("本地请求超时"))); req.end(options.body);
  });
}
async function stop(child?: ChildProcess) {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
}
try {
  const template = await fs.readFile("deploy/nginx.conf.example", "utf8");
  const servers = template.replaceAll("SUPERVISOR_DOMAIN", "localhost")
    .replace("listen 80;", "listen 127.0.0.1:8088;").replace("listen 443 ssl;", "listen 127.0.0.1:9448 ssl;")
    .replace("https://$host$request_uri", "https://$host:9448$request_uri")
    .replace("/etc/letsencrypt/live/localhost/fullchain.pem", cert).replace("/etc/letsencrypt/live/localhost/privkey.pem", key)
    .replaceAll("127.0.0.1:3000", "127.0.0.1:3108");
  // 项目路径含空格/中文，证书路径必须引用，避免掩盖目标模板的加载错误。
  const quoted = servers.replace(`ssl_certificate ${cert};`, `ssl_certificate "${cert}";`).replace(`ssl_certificate_key ${key};`, `ssl_certificate_key "${key}";`);
  const config = path.join(prefix, "conf/local-rehearsal.conf");
  await fs.writeFile(config, `worker_processes 1;\nevents { worker_connections 128; }\nhttp { access_log off;\n${quoted}\n}\n`, { mode: 0o600 });
  check(spawnSync(nginx, ["-p", `${prefix}/`, "-c", config, "-t"], { stdio: "ignore" }).status === 0, "真实nginx加载部署模板与TLS配置");
  await root.query(`CREATE DATABASE \`${database}\``);
  for (const table of ["users", "semesters", "courses", "course_evaluations", "listening_plans", "notifications"]) await root.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE zjgsu_preview_20261004.\`${table}\``);
  await root.query(`INSERT INTO \`${database}\`.users (openId,employeeId,name,role,password) VALUES ('proxy-local-only','proxy-local-only','虚构代理验收','admin',?)`, [await hashPassword(loginPassword)]);
  await root.query(`INSERT INTO \`${database}\`.semesters (academicYear,name,startDate,totalWeeks,isActive) VALUES ('2026-2027','虚构代理验收学期','2026-09-14',18,1)`);
  await root.query(`CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`, [databasePassword]);
  await root.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${database}\`.* TO '${account}'@'127.0.0.1'`);
  app = spawn(node, ["dist/index.js"], { cwd: release.target, stdio: "ignore", env: { ...process.env, NODE_ENV: "production", APP_HOST: "127.0.0.1", PORT: "3108", TRUST_PROXY: "loopback", DISABLE_SCHEDULER: "1", DOTENV_CONFIG_PATH: "/dev/null", RELEASE_COMMIT: revision, DATABASE_URL: `mysql://${account}:${databasePassword}@127.0.0.1:3306/${database}`, JWT_SECRET: randomBytes(48).toString("hex"), OAUTH_SERVER_URL: "", OWNER_OPEN_ID: "", BUILT_IN_FORGE_API_URL: "", BUILT_IN_FORGE_API_KEY: "" } });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await request("http://127.0.0.1:3108/api/health")).status === 200; } catch {}
    if (ready || app.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  check(ready, "固定生产构建在指定Node版本真实启动、连接新虚构库");
  proxy = spawn(nginx, ["-p", `${prefix}/`, "-c", config, "-g", "daemon off;"], { stdio: "ignore" });
  let health: Awaited<ReturnType<typeof request>> | undefined;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { health = await request("https://127.0.0.1:9448/api/health"); break; } catch {}
    if (proxy.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  check(health?.status === 200 && JSON.parse(health.body).revision === revision, "校验专用证书后HTTPS健康检查返回正确版本");
  const redirect = await request("http://127.0.0.1:8088/login");
  check(redirect.status === 301 && redirect.headers.location === "https://127.0.0.1:9448/login", "HTTP跳转HTTPS保留请求路径");
  const loginBody = JSON.stringify({ json: { employeeId: "proxy-local-only", password: loginPassword } });
  const login = await request("https://127.0.0.1:9448/api/trpc/auth.loginByEmployeeId", { body: loginBody, headers: { "X-Forwarded-Proto": "http", "X-Forwarded-For": "203.0.113.1" } });
  const cookie = login.headers["set-cookie"]?.[0];
  check(login.status === 200 && cookie && /;\s*Secure/i.test(cookie) && /;\s*HttpOnly/i.test(cookie), "HTTPS登录设置Secure与HttpOnly，客户端转发头不能降级");
  const session = await request("https://127.0.0.1:9448/api/trpc/semesters.list", { headers: { Cookie: cookie!.split(";")[0] } });
  check(session.status === 200 && JSON.parse(session.body).result?.data?.json?.[0]?.name === "虚构代理验收学期", "HTTPS会话可读取授权学期");
  check(health?.headers["x-content-type-options"] === "nosniff" && health?.headers["referrer-policy"] === "same-origin", "代理安全响应头实际生效");
  let obsoleteRejected = false;
  try { await request("https://127.0.0.1:9448/api/health", { maxVersion: "TLSv1.1" }); } catch { obsoleteRejected = true; }
  check(obsoleteRejected, "低于TLS1.2的连接被拒绝");
  // 改变伪造转发地址不应避开nginx真实来源限流；涵盖tRPC批量路径。
  const burst = await Promise.all(Array.from({ length: 24 }, (_, i) => request("https://127.0.0.1:9448/api/trpc/auth.loginByEmployeeId?batch=1", { body: JSON.stringify({ 0: { json: { employeeId: `proxy-invalid-${i}`, password: "invalid-test-only" } } }), headers: { "X-Forwarded-For": `203.0.113.${i + 1}` } })));
  const rejected = burst.filter(r => r.status === 429).length;
  check(rejected >= 10, "真实nginx批量登录返回429，伪造来源地址不能绕过限流");
  const [counts] = await root.query<any[]>(`SELECT (SELECT COUNT(*) FROM \`${database}\`.users) users,(SELECT COUNT(*) FROM \`${database}\`.semesters) semesters,(SELECT COUNT(*) FROM \`${database}\`.course_evaluations) evaluations`);
  check(counts[0].users === 1 && counts[0].semesters === 1 && counts[0].evaluations === 0, "代理演练没有导入真实数据或产生评价");
  await fs.writeFile("tmp/acceptance/proxy-report.json", JSON.stringify({ passed, database, revision, nodeVersion: spawnSync(node, ["--version"], { encoding: "utf8" }).stdout.trim(), nginxVersion: spawnSync(nginx, ["-v"], { encoding: "utf8" }).stderr.trim(), rejected, trustedLocalCertificate: true, productionCertificate: false, result: "PASS" }, null, 2), { mode: 0o600 });
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : "隔离代理验收失败；未输出凭据、Cookie或连接配置"); process.exitCode = 1;
} finally {
  await stop(proxy); await stop(app);
  await root.query(`DROP USER IF EXISTS '${account}'@'127.0.0.1'`); await root.end();
}
