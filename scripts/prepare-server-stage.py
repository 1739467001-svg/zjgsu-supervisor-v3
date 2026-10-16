"""部署前隔离候选。原库/旧服务不变；密钥仅写服务器受限文件。"""
import hashlib, pathlib, secrets, subprocess, pwd, os
ROOT = pathlib.Path('/root/zjgsu-release-backup-20261014-1040')
SQL = ROOT / 'upgrade-candidate.sql'
REV = 'a9a4b385d4a4800033095825779ccec21db327db'
RELEASE = pathlib.Path('/srv/zjgsu-supervisor-v3/releases') / REV
DB = 'zjgsu_history_test_c8446e847c'
ACCOUNT = 'zjgsu_v3_stage'
def run(args, data=None):
    result = subprocess.run(args, input=data, text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if result.returncode: raise RuntimeError('服务器隔离步骤失败，敏感输出已隐去')
    return result.stdout
if hashlib.sha256(SQL.read_bytes()).hexdigest() != '81538e971fe0d90846b83e00abc52d0fe4670360a0371b2b7f0d222167bb74f5':
    raise RuntimeError('上传候选SQL散列不一致')
if not (RELEASE / 'release.json').exists(): raise RuntimeError('独立生产构建尚未完成')
if run(['mysql','-N','-B','-e', f"SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME='{DB}'"]).strip():
    raise RuntimeError('候选库已存在，拒绝覆盖')
run(['mysql','-e', f'CREATE DATABASE `{DB}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'])
with SQL.open() as source:
    result = subprocess.run(['mysql', DB], stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode: raise RuntimeError('隔离恢复失败，原库未动')
count = run(['mysql','-N','-B',DB,'-e','SELECT COUNT(*) FROM courses; SELECT COUNT(*) FROM course_evaluations; SELECT COUNT(*) FROM listening_plans; SELECT COUNT(*) FROM notifications; SELECT COUNT(*) FROM users;'])
if count.split() != ['4101','81','58','352','101']: raise RuntimeError('候选记录数不一致，停止启动')
try: service_user = pwd.getpwnam('zjgsu-v3')
except KeyError:
    run(['useradd','--system','--home','/srv/zjgsu-supervisor-v3','--shell','/usr/sbin/nologin','zjgsu-v3'])
    service_user = pwd.getpwnam('zjgsu-v3')
password, jwt = secrets.token_hex(32), secrets.token_hex(48)
run(['mysql'], f"CREATE USER '{ACCOUNT}'@'127.0.0.1' IDENTIFIED BY '{password}'; GRANT SELECT,INSERT,UPDATE,DELETE ON `{DB}`.* TO '{ACCOUNT}'@'127.0.0.1';")
shared = pathlib.Path('/srv/zjgsu-supervisor-v3/shared'); shared.mkdir(mode=0o750,exist_ok=True)
os.chown(shared,0,service_user.pw_gid)
env = shared / 'stage.env'
with env.open('x') as out:
    out.write(f'DATABASE_URL=mysql://{ACCOUNT}:{password}@127.0.0.1:3306/{DB}\nJWT_SECRET={jwt}\nNODE_ENV=production\nAPP_HOST=127.0.0.1\nPORT=3010\nDISABLE_SCHEDULER=1\nTRUST_PROXY=loopback\nDOTENV_CONFIG_PATH=/dev/null\nOAUTH_SERVER_URL=\nBUILT_IN_FORGE_API_URL=\nBUILT_IN_FORGE_API_KEY=\n')
os.chmod(env,0o640); os.chown(env,0,service_user.pw_gid)
for path in [RELEASE.parent.parent, RELEASE.parent, RELEASE]: os.chmod(path,0o755)
# 准备时权限可受root umask影响；只对新固定代码开放服务读取，原目录不变。
for base, dirs, files in os.walk(RELEASE):
    for d in dirs:
        path = pathlib.Path(base)/d
        if not path.is_symlink(): os.chmod(path,0o755)
    for f in files:
        path = pathlib.Path(base)/f
        if not path.is_symlink(): os.chmod(path,0o755 if path.stat().st_mode & 0o111 else 0o644)
unit = pathlib.Path('/etc/systemd/system/zjgsu-v3-stage.service')
with unit.open('x') as out:
    out.write(f'''[Unit]
Description=ZJGSU V3 isolated acceptance
After=network.target mysql.service
[Service]
Type=simple
User=zjgsu-v3
Group=zjgsu-v3
WorkingDirectory={RELEASE}
EnvironmentFile={env}
EnvironmentFile={RELEASE}/release.env
ExecStart=/opt/zjgsu-node-v22.23.3/bin/node {RELEASE}/dist/index.js
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
[Install]
WantedBy=multi-user.target
''')
run(['systemctl','daemon-reload']); run(['systemctl','start','zjgsu-v3-stage.service'])
print('隔离候选已恢复：4101课程、81评价、58计划、352通知、101账号；只监听3010本机端口，旧服务不变。')
