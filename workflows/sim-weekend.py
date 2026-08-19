#!/usr/bin/env python3
"""주말 시뮬레이션 러너.

WF-1 사본에 웹훅 트리거를 붙이고, 발행(WF-4) 연결을 끊은 SIM 워크플로를 만든다.
dayType/round는 웹훅 본문으로 주입하므로 한 번 배포하면 날짜별로 호출만 하면 된다.

  python3 sim-weekend.py deploy            # SIM 배포 + 활성화 (n8n 재시작 1회)
  python3 sim-weekend.py run <dayType> <round>
"""
import base64, json, subprocess, sys, time
from _env import KEY, HOST

SRC = "wf1-main-scheduler.json"
SIM_ID = "HooniWF1Sim00001"
PATH = "hooni-sim"
NO_PUBLISH = False  # True면 WF-4 발행 연결을 끊는다

WEBHOOK_NODE = {
    "parameters": {"httpMethod": "POST", "path": PATH, "responseMode": "onReceived", "options": {}},
    "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [-1050, 320],
    "id": "s0000001-0000-4000-8000-000000000001", "name": "Sim Trigger",
    "webhookId": "s0000001-0000-4000-8000-000000000001",
}


def sh(cmd, timeout=600):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)


def build():
    wf = json.load(open(SRC))
    wf["id"] = SIM_ID
    wf["name"] = "HooniSpeed WF-1 SIM"
    wf["active"] = True
    wf.setdefault("settings", {}).pop("errorWorkflow", None)

    wf["nodes"].append(WEBHOOK_NODE)

    for node in wf["nodes"]:
        if node["name"] == "Resolve Day Type":
            code = node["parameters"]["jsCode"]
            assert "const OVERRIDE = null;" in code, "OVERRIDE 훅을 찾지 못했다"
            node["parameters"]["jsCode"] = code.replace(
                "const OVERRIDE = null;",
                "const OVERRIDE = $('Sim Trigger').first().json.body || null;",
            )

    conns = wf.setdefault("connections", {})
    conns["Sim Trigger"] = {"main": [[{"node": "Jolpica Calendar", "type": "main", "index": 0}]]}
    if NO_PUBLISH:
        conns.pop("Build Caption", None)  # 발행 차단

    out = "/tmp/wf1-sim.json"
    json.dump(wf, open(out, "w"), ensure_ascii=False)
    return out


def guard_idle():
    """렌더링(browserless) 중에는 배포하지 않는다 — 956MB 서버에서 동시 실행 시 스왑 폭주."""
    for _ in range(60):
        r = sh(f'ssh -i {KEY} -o BatchMode=yes -o ConnectTimeout=25 {HOST} '
               f'"grep MemAvailable /proc/meminfo; echo chrome=\\$(pgrep -c chrome)"', timeout=120)
        out = r.stdout
        avail = next((int(l.split()[1]) // 1024 for l in out.splitlines() if "MemAvailable" in l), 0)
        chrome = next((int(l.split("=")[1]) for l in out.splitlines() if l.startswith("chrome=")), 99)
        if avail >= 260 and chrome == 0:
            print(f"배포 가능 (여유 {avail}MB, chrome {chrome}개)", flush=True); return
        print(f"대기 중 — 여유 {avail}MB, chrome {chrome}개", flush=True)
        time.sleep(20)
    raise SystemExit("서버가 계속 바쁘다 — 배포 중단")


def deploy():
    guard_idle()
    build()
    sh(f'scp -q -i {KEY} -o BatchMode=yes /tmp/wf1-sim.json {HOST}:~/hooni_speed/workflows/')
    # timeout을 걸어 import가 DB 락에 걸려 영원히 매달리는 일을 막는다
    r = sh(f'ssh -i {KEY} -o BatchMode=yes -o ConnectTimeout=25 {HOST} "'
           f'sudo timeout 180 docker exec n8n n8n import:workflow --input=/data/hooni_speed/workflows/wf1-sim.json >/dev/null 2>&1 && echo imported || echo IMPORT_FAIL; '
           f'sudo timeout 120 docker exec n8n n8n update:workflow --id={SIM_ID} --active=true >/dev/null 2>&1 && echo activated || echo ACTIVATE_FAIL"',
           timeout=400)
    print(r.stdout.strip() or r.stderr[-300:], flush=True)
    if "IMPORT_FAIL" in r.stdout:
        sh(f'ssh -i {KEY} -o BatchMode=yes {HOST} "sudo pkill -9 -f \'n8n imp[o]rt:workflow\'"', timeout=120)
        raise SystemExit("import 실패 — 멈춘 프로세스를 정리했다. 서버 상태 확인 후 재시도")

    sh(f'ssh -i {KEY} -o BatchMode=yes -o ConnectTimeout=25 {HOST} "sudo docker restart n8n >/dev/null"', timeout=400)
    print("n8n 재시작 — 기동 대기...", flush=True)
    for _ in range(60):
        time.sleep(10)
        ok = sh(f'ssh -i {KEY} -o BatchMode=yes -o ConnectTimeout=25 {HOST} '
                f'"curl -s -o /dev/null -w %{{http_code}} --max-time 20 localhost:5678/healthz"', timeout=120).stdout.strip()
        if ok == "200":
            time.sleep(15)  # 웹훅 등록까지 여유를 둔다
            print("n8n 준비 완료", flush=True); return
    print("경고: 헬스체크 실패", flush=True)


def run(day_type, rnd):
    # browserless는 렌더 후에도 Chromium을 물고 있어 100MB 이상을 잡아먹는다.
    # 실행 직전에 초기화해야 렌더 시점에 여유 메모리가 확보된다.
    sh(f'ssh -i {KEY} -o BatchMode=yes -o ConnectTimeout=25 {HOST} '
       f'"docker restart browserless >/dev/null"', timeout=300)
    for _ in range(30):
        time.sleep(10)
        avail = sh(f'ssh -i {KEY} -o BatchMode=yes -o ConnectTimeout=25 {HOST} '
                   f'"grep MemAvailable /proc/meminfo"', timeout=120).stdout
        mb = int(avail.split()[1]) // 1024 if avail.strip() else 0
        if mb >= 240:
            print(f"여유 메모리 {mb}MB — 실행", flush=True); break
        print(f"메모리 회복 대기 — {mb}MB", flush=True)
    else:
        raise SystemExit("여유 메모리가 240MB에 도달하지 않는다 — 실행 중단")

    body = json.dumps({"dayType": day_type, "round": int(rnd)})
    b64 = base64.b64encode(body.encode()).decode()
    r = sh(f"ssh -i {KEY} -o BatchMode=yes {HOST} "
           f"'echo {b64} | base64 -d | curl -s -X POST localhost:5678/webhook/{PATH} "
           f"-H \"Content-Type: application/json\" --data-binary @-'")
    print(f"[{day_type} / round {rnd}] 트리거:", r.stdout.strip()[:200] or r.stderr[-200:])


if __name__ == "__main__":
    if sys.argv[1] == "deploy":
        deploy()
    else:
        run(sys.argv[2], sys.argv[3])
