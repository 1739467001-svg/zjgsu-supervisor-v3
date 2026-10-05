/** 独立本地预览：只复制本机表结构，不读取业务行，不复用生产配置。 */
import mysql from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const database = "zjgsu_preview_20261004";
const account = "zjgsu_preview_20261004";
const password = randomBytes(32).toString("hex");
const connection = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root" });
try {
  // 故意不使用 IF NOT EXISTS：发现同名库就停下，不能复用不明数据。
  if (process.argv.includes("--resume")) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ?`, [database]);
    if ((rows as any[])[0].count !== 6) throw new Error("预览库表数量不符，停止启动");
    await connection.query(`ALTER USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`, [password]);
  } else {
  await connection.query(`CREATE DATABASE \`${database}\``);
  for (const table of ["users", "courses", "semesters", "course_evaluations", "listening_plans", "notifications"]) {
    await connection.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE zjgsu_supervisor.\`${table}\``);
  }
  await connection.query(`CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`, [password]);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO '${account}'@'127.0.0.1'`);
  }
} finally {
  await connection.end();
}

// 覆盖继承配置，凭据只保留在进程内存，不写文件、不打印。
process.env.DATABASE_URL = `mysql://${account}:${password}@127.0.0.1:3306/${database}`;
process.env.JWT_SECRET = randomBytes(48).toString("hex");
process.env.DOTENV_CONFIG_PATH = "/dev/null";
process.env.NODE_ENV = "production";
process.env.APP_HOST = "127.0.0.1";
process.env.PORT = "3000";
process.env.DISABLE_SCHEDULER = "1";
process.env.VITE_APP_ID = "local-preview";
for (const key of ["OAUTH_SERVER_URL", "OWNER_OPEN_ID", "BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY"]) process.env[key] = "";
console.log("独立本地预览库已就绪；仅本机访问；提醒已禁用。");
const child = spawn(process.execPath, ["dist/index.js"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 0));
