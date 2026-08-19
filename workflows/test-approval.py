#!/usr/bin/env python3
"""승인 루프 E2E 테스트: 웹훅 → WF-2 렌더(3장) → WF-3 텔레그램 승인
발행(WF-4)은 호출하지 않는다."""
import json, subprocess
from _env import KEY, HOST

R = [
    {"pos": 1, "name": "Lando Norris", "team": "McLaren", "time": "1:17.207"},
    {"pos": 2, "name": "Lewis Hamilton", "team": "Ferrari", "time": "1:17.219"},
    {"pos": 3, "name": "Charles Leclerc", "team": "Ferrari", "time": "1:17.445"},
    {"pos": 4, "name": "Kimi Antonelli", "team": "Mercedes", "time": "1:17.479"},
    {"pos": 5, "name": "Oscar Piastri", "team": "McLaren", "time": "1:17.684"},
    {"pos": 6, "name": "Max Verstappen", "team": "Red Bull", "time": "1:17.725"},
    {"pos": 7, "name": "George Russell", "team": "Mercedes", "time": "1:17.760"},
    {"pos": 8, "name": "Isack Hadjar", "team": "Red Bull", "time": "1:17.856"},
    {"pos": 9, "name": "Arvid Lindblad", "team": "RB F1 Team", "time": "1:18.281"},
    {"pos": 10, "name": "Nico Hülkenberg", "team": "Audi", "time": "1:18.686"},
]
PAYLOAD = {
    "dayType": "approval-test",
    "season": 2026, "round": 11,
    "raceName": "Hungarian Grand Prix", "circuitId": "hungaroring",
    "dateKst": "2026-08-13",
    "cards": [
        {"type": "cover", "template": "cover-data",
         "data": {"title": "헝가리 그랑프리 퀄리파잉", "subtitle": "노리스, 0.012초 차 폴 포지션"}},
        {"type": "quali-top", "template": "session-result",
         "data": {"session": "Q3 Top 10", "rows": R}},
        {"type": "issue", "template": "issue", "needsLlm": ["issueSummary"],
         "data": {"session": "퀄리파잉", "body": None,
                  "fastestLap": {"name": "Lando Norris", "time": "1:17.207"}}},
    ],
}

TEST_ID = "HooniWF3TestExec"
wf = {
    "id": TEST_ID,
    "name": "HooniSpeed WF-3 승인 테스트",
    "nodes": [
        {"parameters": {"path": "hooni-test-approval", "options": {}},
         "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
         "id": "t0000001-0000-4000-8000-000000000000", "name": "Webhook",
         "webhookId": "t0000001-0000-4000-8000-000000000000"},
        {"parameters": {"jsCode": "return [{ json: " + json.dumps(PAYLOAD, ensure_ascii=False) + " }];"},
         "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0],
         "id": "t0000002-0000-4000-8000-000000000000", "name": "Inject Payload"},
        {"parameters": {"workflowId": {"__rl": True, "value": "HooniWF2Rndr0001", "mode": "id"},
                        "workflowInputs": {"mappingMode": "passthrough"}, "options": {}},
         "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.2, "position": [440, 0],
         "id": "t0000003-0000-4000-8000-000000000000", "name": "Render (WF-2)"},
        {"parameters": {"workflowId": {"__rl": True, "value": "HooniWF3Appr0001", "mode": "id"},
                        "workflowInputs": {"mappingMode": "passthrough"}, "options": {}},
         "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.2, "position": [660, 0],
         "id": "t0000004-0000-4000-8000-000000000000", "name": "Approve (WF-3)"},
        {"parameters": {"jsCode": "const p = $input.first().json;\nreturn [{ json: { 결과: p.approved ? '승인됨' : '거부/중단', 수정횟수: p.revision, 카드수: p.cardCount, urls: p.urls } }];"},
         "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [880, 0],
         "id": "t0000005-0000-4000-8000-000000000000", "name": "Result"},
    ],
    "connections": {
        "Webhook": {"main": [[{"node": "Inject Payload", "type": "main", "index": 0}]]},
        "Inject Payload": {"main": [[{"node": "Render (WF-2)", "type": "main", "index": 0}]]},
        "Render (WF-2)": {"main": [[{"node": "Approve (WF-3)", "type": "main", "index": 0}]]},
        "Approve (WF-3)": {"main": [[{"node": "Result", "type": "main", "index": 0}]]},
    },
    "settings": {"executionOrder": "v1", "timezone": "Asia/Seoul"},
    "active": True,
}

open("/tmp/wf3-test.json", "w").write(json.dumps(wf, ensure_ascii=False))
subprocess.run(["scp", "-q", "-i", KEY, "-o", "BatchMode=yes", "/tmp/wf3-test.json",
                f"{HOST}:~/hooni_speed/workflows/"], check=True)
print(subprocess.run(["ssh", "-i", KEY, "-o", "BatchMode=yes", HOST,
    "sudo docker exec n8n n8n import:workflow --input=/data/hooni_speed/workflows/wf3-test.json >/dev/null 2>&1 && echo imported; "
    f"sudo docker exec n8n n8n update:workflow --id={TEST_ID} --active=true >/dev/null 2>&1 && echo activated; "
    "sudo docker restart n8n >/dev/null && echo restarted"],
    capture_output=True, text=True, timeout=300).stdout)
