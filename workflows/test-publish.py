#!/usr/bin/env python3
"""발행 E2E 테스트: 렌더 → 승인 → 캡션 → 인스타 실발행 → 파일 정리
※ hooni.speed 계정에 실제 게시물이 올라간다. 확인 후 수동 삭제 필요."""
import json, subprocess
from _env import KEY, HOST

TEST_ID = "HooniWF4TestPub1"

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
    "dayType": "quali-results", "season": 2026, "round": 11,
    "raceName": "Hungarian Grand Prix", "circuitId": "hungaroring",
    "dateKst": "2026-08-12",
    "cards": [
        {"type": "cover", "template": "cover-data",
         "data": {"title": "헝가리 그랑프리 퀄리파잉", "subtitle": "노리스, 0.012초 차 폴 포지션"}},
        {"type": "quali-top", "template": "session-result",
         "data": {"session": "Q3 Top 10", "rows": R}},
        {"type": "grid", "template": "grid",
         "data": {"title": "레이스 그리드", "note": "퀄리파잉 기준",
                  "rows": [{"pos": r["pos"], "name": r["name"], "team": r["team"]} for r in R]}},
    ],
}

CAPTION_CODE = (
    "const p = $input.first().json;\n"
    "const TYPE_LABEL = { preview: '프리뷰', guide: '관전 가이드', 'practice-results': '연습주행 결과', "
    "'quali-results': '퀄리파잉 결과', 'sprint-fri-results': '스프린트 퀄리파잉', "
    "'sprint-sat-results': '스프린트 & 퀄리파잉', 'race-recap': '레이스 총정리' };\n"
    "const caption = p.season + ' ' + p.raceName + ' ' + (TYPE_LABEL[p.dayType] || '') + "
    "'\\n\\n#후니스피드 #F1 #Formula1 #' + String(p.raceName || '').replace(/\\s+/g, '');\n"
    "return [{ json: { ...p, caption } }];"
)

wf = {
    "id": TEST_ID,
    "name": "HooniSpeed WF-4 발행 테스트",
    "nodes": [
        {"parameters": {"path": "hooni-test-publish", "options": {}},
         "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
         "id": "p0000001-0000-4000-8000-000000000000", "name": "Webhook",
         "webhookId": "p0000001-0000-4000-8000-000000000000"},
        {"parameters": {"jsCode": "return [{ json: " + json.dumps(PAYLOAD, ensure_ascii=False) + " }];"},
         "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [200, 0],
         "id": "p0000002-0000-4000-8000-000000000000", "name": "Inject Payload"},
        {"parameters": {"workflowId": {"__rl": True, "value": "HooniWF2Rndr0001", "mode": "id"},
                        "workflowInputs": {"mappingMode": "passthrough"}, "options": {}},
         "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.2, "position": [400, 0],
         "id": "p0000003-0000-4000-8000-000000000000", "name": "Render (WF-2)"},
        {"parameters": {"workflowId": {"__rl": True, "value": "HooniWF3Appr0001", "mode": "id"},
                        "workflowInputs": {"mappingMode": "passthrough"}, "options": {}},
         "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.2, "position": [600, 0],
         "id": "p0000004-0000-4000-8000-000000000000", "name": "Approve (WF-3)"},
        {"parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                                        "conditions": [{"leftValue": "={{ $json.approved }}", "rightValue": True,
                                                        "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                                        "combinator": "and"}, "options": {}},
         "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [800, 0],
         "id": "p0000005-0000-4000-8000-000000000000", "name": "IF Approved"},
        {"parameters": {"jsCode": CAPTION_CODE},
         "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [1000, -100],
         "id": "p0000006-0000-4000-8000-000000000000", "name": "Build Caption"},
        {"parameters": {"workflowId": {"__rl": True, "value": "HooniWF4Publ0001", "mode": "id"},
                        "workflowInputs": {"mappingMode": "passthrough"}, "options": {}},
         "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.2, "position": [1200, -100],
         "id": "p0000007-0000-4000-8000-000000000000", "name": "Publish (WF-4)"},
    ],
    "connections": {
        "Webhook": {"main": [[{"node": "Inject Payload", "type": "main", "index": 0}]]},
        "Inject Payload": {"main": [[{"node": "Render (WF-2)", "type": "main", "index": 0}]]},
        "Render (WF-2)": {"main": [[{"node": "Approve (WF-3)", "type": "main", "index": 0}]]},
        "Approve (WF-3)": {"main": [[{"node": "IF Approved", "type": "main", "index": 0}]]},
        "IF Approved": {"main": [[{"node": "Build Caption", "type": "main", "index": 0}], []]},
        "Build Caption": {"main": [[{"node": "Publish (WF-4)", "type": "main", "index": 0}]]},
    },
    "settings": {"executionOrder": "v1", "timezone": "Asia/Seoul", "errorWorkflow": "HooniWFErr00001"},
    "active": True,
}

open("/tmp/wf4-test.json", "w").write(json.dumps(wf, ensure_ascii=False))
subprocess.run(["scp", "-q", "-i", KEY, "-o", "BatchMode=yes", "/tmp/wf4-test.json",
                f"{HOST}:~/hooni_speed/workflows/"], check=True)
print(subprocess.run(["ssh", "-i", KEY, "-o", "BatchMode=yes", HOST,
    "sudo docker exec n8n n8n import:workflow --input=/data/hooni_speed/workflows/wf4-test.json >/dev/null 2>&1 && echo imported; "
    f"for id in HooniWF2Rndr0001 HooniWF3Appr0001 HooniWF4Publ0001 HooniWF7TgList001 HooniWFErr00001 {TEST_ID}; do "
    "sudo docker exec n8n n8n update:workflow --id=$id --active=true >/dev/null 2>&1; done; echo activated; "
    "sudo sqlite3 /home/ubuntu/n8n/data/database.sqlite 'UPDATE execution_entity SET status=\"canceled\" WHERE status IN (\"waiting\",\"running\");'; "
    "sudo docker exec n8n rm -f /data/hooni_speed/pending-approval.json 2>/dev/null; "
    "sudo rm -rf /home/ubuntu/flutter-web/web/hooni-cards/2026-r11-*; "
    "sudo docker restart n8n >/dev/null && echo restarted"],
    capture_output=True, text=True, timeout=400).stdout)
