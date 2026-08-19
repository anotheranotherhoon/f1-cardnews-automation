#!/usr/bin/env python3
"""WF-1 프리뷰 브랜치 E2E: OVERRIDE(preview, R12 더치) → PV 데이터+LLM리서치 → WF-2 렌더 (승인/발행 제외)"""
import json, subprocess, sys, time
from _env import KEY, HOST

DAY_TYPE = sys.argv[1] if len(sys.argv) > 1 else "preview"
ROUND = sys.argv[2] if len(sys.argv) > 2 else "12"

wf = json.load(open("wf1-main-scheduler.json"))
wf["id"] = "HooniWF1TestExec"
wf["name"] = "HooniSpeed WF-1 TEST"
wf["settings"].pop("errorWorkflow", None)
wf["active"] = True
# 트리거 교체: 스케줄/수동 제거, 웹훅 삽입
wf["nodes"] = [n for n in wf["nodes"] if n["name"] not in ("Daily 09:00 KST", "Manual Test Trigger")]
wf["nodes"].insert(0, {"parameters": {"path": "hooni-test-wf1", "options": {}}, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [-1050, 0], "id": "e1000001-0000-4000-8000-000000000000", "name": "Webhook", "webhookId": "e1000001-0000-4000-8000-000000000000"})
for k in ("Daily 09:00 KST", "Manual Test Trigger"):
    wf["connections"].pop(k, None)
wf["connections"]["Webhook"] = {"main": [[{"node": "Jolpica Calendar", "type": "main", "index": 0}]]}
# OVERRIDE 주입
for n in wf["nodes"]:
    if n["name"] == "Resolve Day Type":
        n["parameters"]["jsCode"] = n["parameters"]["jsCode"].replace(
            "const OVERRIDE = null;", f'const OVERRIDE = {{"dayType":"{DAY_TYPE}","round":"{ROUND}"}};')
# 꼬리 절단: 렌더까지만 (승인/발행 제외)
wf["connections"]["Render (WF-2)"] = {"main": [[]]}

open("/tmp/wf1-test.json", "w").write(json.dumps(wf, ensure_ascii=False))
subprocess.run(["scp", "-q", "-i", KEY, "-o", "BatchMode=yes", "/tmp/wf1-test.json", f"{HOST}:~/hooni_speed/workflows/wf1-test.json"], check=True)
print(subprocess.run(["ssh", "-i", KEY, "-o", "BatchMode=yes", HOST,
    "sudo docker exec n8n n8n import:workflow --input=/data/hooni_speed/workflows/wf1-test.json >/dev/null 2>&1 && echo imported; "
    "sudo docker exec n8n n8n update:workflow --id=HooniWF1TestExec --active=true >/dev/null 2>&1 && echo activated; "
    "sudo docker restart n8n >/dev/null && echo restarted"],
    capture_output=True, text=True, timeout=300).stdout)
# 웹훅 등록 대기 후 발화
print(subprocess.run(["ssh", "-i", KEY, "-o", "BatchMode=yes", HOST,
    'for i in $(seq 1 12); do sleep 25; CODE=$(curl -s -m 30 -o /dev/null -w "%{http_code}" http://localhost:5678/webhook/hooni-test-wf1 2>/dev/null); '
    'if [ "$CODE" = "200" ]; then echo "fired (try $i)"; break; else echo "try $i: $CODE"; fi; done'],
    capture_output=True, text=True, timeout=600).stdout)
