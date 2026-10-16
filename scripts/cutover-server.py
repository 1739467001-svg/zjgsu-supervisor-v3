"""明确授权的IP正式切换；任一检查失败保留旧系统，原数据库不覆盖。"""
import pathlib, subprocess, json, time
ROOT=pathlib.Path('/root/zjgsu-release-backup-20261014-1040')
NODE='/opt/zjgsu-node-v22.23.3/bin/node'
def run(args):
    r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if r.returncode: raise RuntimeError('切换步骤失败，检查私有日志；未输出配置或凭据')
    return r.stdout
health=json.loads(run(['curl','--fail','--max-time','8','-s','http://127.0.0.1:3010/api/health']))
if health.get('revision')!='a9a4b385d4a4800033095825779ccec21db327db': raise RuntimeError('新服务版本不符')
run([NODE,str(ROOT/'verify-production-data.mjs'),'--remote','--production'])
backup=ROOT/f'final-before-cutover-20261016-{time.time_ns()}.sql'
with backup.open('x') as out:
    if subprocess.run(['mysqldump','--single-transaction','--skip-lock-tables','--no-tablespaces','--set-gtid-purged=OFF','zjgsu_supervisor'],stdout=out,stderr=subprocess.DEVNULL).returncode: raise RuntimeError('切换前备份失败')
backup.chmod(0o600)
old=pathlib.Path('/etc/nginx/sites-available/zjgsu-supervisor')
tls=pathlib.Path('/etc/nginx/conf.d/zjgsu-v3-ip-stage.conf')
old_text,tls_text=old.read_text(),tls.read_text()
old.write_text('''server {
 listen 80;
 server_name 121.196.217.243 _;
 location ^~ /.well-known/acme-challenge/ { root /var/lib/zjgsu-acme; default_type text/plain; }
 location / { return 301 https://121.196.217.243$request_uri; }
}
''')
tls.write_text(tls_text.replace('listen 127.0.0.1:9443 ssl;', 'listen 443 ssl;'))
stopped=False
try:
    run(['nginx','-t'])
    run(['pm2','stop','zjgsu-supervisor']); stopped=True
    run([NODE,str(ROOT/'verify-production-data.mjs'),'--remote','--production'])
    run(['systemctl','reload','nginx'])
    for attempt in range(15):
        try:
            result=json.loads(run(['curl','--fail','--max-time','3','--connect-to','121.196.217.243:443:127.0.0.1:443','-s','https://121.196.217.243/api/health']))
            if result.get('revision')==health['revision']: break
        except Exception: pass
        time.sleep(1)
    else: raise RuntimeError('HTTPS新服务检查失败')
    run(['systemctl','enable','zjgsu-supervisor-v3.service'])
    print('正式IP入口已切换，新服务HTTPS健康检查通过；原库及旧服务文件保留。')
except Exception:
    old.write_text(old_text);tls.write_text(tls_text)
    run(['nginx','-t']);run(['systemctl','reload','nginx'])
    if stopped: run(['pm2','restart','zjgsu-supervisor'])
    raise
