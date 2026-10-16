"""在已验收候选外新建正式库，保留旧生产库及所有快照；不切换公网。"""
import pathlib, subprocess, secrets, os, pwd
ROOT=pathlib.Path('/srv/zjgsu-supervisor-v3')
DB='zjgsu_v3_20261016'
SOURCE='zjgsu_history_test_c8446e847c'
def run(args,data=None):
    r=subprocess.run(args,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    if r.returncode: raise RuntimeError('正式准备失败，原库和入口未修改；敏感输出已隐去')
    return r.stdout
if run(['mysql','-N','-B','-e',f"SELECT SCHEMA_NAME FROM information_schema.schemata WHERE SCHEMA_NAME='{DB}'"]).strip(): raise RuntimeError('正式库已存在，拒绝覆盖')
run(['mysql','-e',f'CREATE DATABASE `{DB}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'])
dump=run(['mysqldump','--single-transaction','--skip-lock-tables','--no-tablespaces','--set-gtid-purged=OFF',SOURCE])
run(['mysql',DB],dump)
password,jwt=secrets.token_hex(32),secrets.token_hex(48)
run(['mysql'],f"CREATE USER 'zjgsu_v3_app'@'127.0.0.1' IDENTIFIED BY '{password}'; GRANT SELECT,INSERT,UPDATE,DELETE ON `{DB}`.* TO 'zjgsu_v3_app'@'127.0.0.1';")
user=pwd.getpwnam('zjgsu-v3')
runtime=ROOT/'shared/runtime.env'
with runtime.open('x') as out: out.write(f'DATABASE_URL=mysql://zjgsu_v3_app:{password}@127.0.0.1:3306/{DB}\nJWT_SECRET={jwt}\nNODE_ENV=production\nAPP_HOST=127.0.0.1\nPORT=3010\nDISABLE_SCHEDULER=1\nTRUST_PROXY=loopback\nDOTENV_CONFIG_PATH=/dev/null\nOAUTH_SERVER_URL=\nBUILT_IN_FORGE_API_URL=\nBUILT_IN_FORGE_API_KEY=\n')
os.chmod(runtime,0o640);os.chown(runtime,0,user.pw_gid)
(ROOT/'current').symlink_to(ROOT/'releases/a9a4b385d4a4800033095825779ccec21db327db')
(ROOT/'previous').symlink_to(ROOT/'releases/e0a1dff2f995ce852d317d021ec22e954b108111')
unit=pathlib.Path('/etc/systemd/system/zjgsu-supervisor-v3.service')
with unit.open('x') as out: out.write(f'''[Unit]
Description=Zhejiang Gongshang University Graduate Supervision V3
After=network.target mysql.service
[Service]
Type=simple
User=zjgsu-v3
Group=zjgsu-v3
WorkingDirectory={ROOT}/current
EnvironmentFile={runtime}
EnvironmentFile={ROOT}/current/release.env
ExecStart=/opt/zjgsu-node-v22.23.3/bin/node --max-old-space-size=384 {ROOT}/current/dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
MemoryMax=640M
MemorySwapMax=512M
[Install]
WantedBy=multi-user.target
''')
run(['systemctl','daemon-reload'])
run(['systemctl','stop','zjgsu-v3-stage.service'])
run(['systemctl','start','zjgsu-supervisor-v3.service'])
print('正式独立库及本机服务已准备；尚未切换公网，提醒暂关闭。')
