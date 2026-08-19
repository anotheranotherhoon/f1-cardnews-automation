#!/usr/bin/env python3
"""WF-2 렌더러 갤러리 테스트: 10종 템플릿을 전부 렌더링해서 로컬로 가져온다."""
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
GRID20 = [{"pos": r["pos"], "name": r["name"], "team": r["team"]} for r in R] + [
    {"pos": 11, "name": "Fernando Alonso", "team": "Aston Martin"},
    {"pos": 12, "name": "Lance Stroll", "team": "Aston Martin"},
    {"pos": 13, "name": "Pierre Gasly", "team": "Alpine"},
    {"pos": 14, "name": "Franco Colapinto", "team": "Alpine"},
    {"pos": 15, "name": "Esteban Ocon", "team": "Haas"},
    {"pos": 16, "name": "Oliver Bearman", "team": "Haas"},
    {"pos": 17, "name": "Gabriel Bortoleto", "team": "Audi"},
    {"pos": 18, "name": "Carlos Sainz", "team": "Williams"},
    {"pos": 19, "name": "Alex Albon", "team": "Williams"},
    {"pos": 20, "name": "Sergio Pérez", "team": "Cadillac"},
]
PAYLOAD = {
    "dayType": "gallery",
    "season": 2026,
    "round": 11,
    "raceName": "Hungarian Grand Prix",
    "circuitId": "hungaroring",
    "dateKst": "2026-08-11",
    "cards": [
        {"type": "cover", "template": "cover-data", "data": {"title": "헝가리 그랑프리 퀄리파잉", "subtitle": "노리스, 0.012초 차 폴 포지션", "isSprint": True}},
        {"type": "quali-top", "template": "session-result", "data": {"session": "Q3 Top 10", "rows": R}},
        {"type": "standings", "template": "standings", "data": {"title": "드라이버 순위", "rows": [
            {"pos": 1, "name": "Kimi Antonelli", "team": "Mercedes", "points": 219, "delta": 0},
            {"pos": 2, "name": "Lando Norris", "team": "McLaren", "points": 210, "delta": 1},
            {"pos": 3, "name": "Oscar Piastri", "team": "McLaren", "points": 202, "delta": -1},
            {"pos": 4, "name": "Max Verstappen", "team": "Red Bull", "points": 188, "delta": 0},
            {"pos": 5, "name": "Charles Leclerc", "team": "Ferrari", "points": 176, "delta": 2},
            {"pos": 6, "name": "Lewis Hamilton", "team": "Ferrari", "points": 158, "delta": 0},
            {"pos": 7, "name": "George Russell", "team": "Mercedes", "points": 149, "delta": -2},
            {"pos": 8, "name": "Isack Hadjar", "team": "Red Bull", "points": 96, "delta": 3},
            {"pos": 9, "name": "Carlos Sainz", "team": "Williams", "points": 71, "delta": None},
            {"pos": 10, "name": "Alex Albon", "team": "Williams", "points": 64, "delta": -1},
        ]}},
        {"type": "grid", "template": "grid", "data": {"title": "레이스 그리드", "note": "퀄리파잉 기준", "rows": GRID20}},
        {"type": "quali-elims", "template": "quali-elims", "data": {
            "elimQ2": [{"pos": r["pos"], "name": r["name"], "team": r["team"], "q2": "1:18.9%d" % i} for i, r in enumerate(GRID20[10:15])],
            "elimQ1": [{"pos": r["pos"], "name": r["name"], "team": r["team"], "q1": "1:19.4%d" % i} for i, r in enumerate(GRID20[15:20])],
        }},
        {"type": "timetable", "template": "timetable", "data": {"timetable": [
            {"session": "FP1", "startKst": "2026-08-21 19:30"},
            {"session": "스프린트 퀄리파잉", "startKst": "2026-08-21 23:30"},
            {"session": "스프린트", "startKst": "2026-08-22 19:00"},
            {"session": "퀄리파잉", "startKst": "2026-08-22 23:00"},
            {"session": "레이스", "startKst": "2026-08-23 22:00"},
        ]}},
        {"type": "lineup", "template": "lineup", "data": {"lineup": {
            "McLaren": [{"name": "L. Norris"}, {"name": "O. Piastri"}],
            "Ferrari": [{"name": "C. Leclerc"}, {"name": "L. Hamilton"}],
            "Mercedes": [{"name": "K. Antonelli"}, {"name": "G. Russell"}],
            "Red Bull": [{"name": "M. Verstappen"}, {"name": "I. Hadjar"}],
            "Aston Martin": [{"name": "F. Alonso"}, {"name": "L. Stroll"}],
            "Alpine": [{"name": "P. Gasly"}, {"name": "F. Colapinto"}],
            "Williams": [{"name": "C. Sainz"}, {"name": "A. Albon"}],
            "RB F1 Team": [{"name": "A. Lindblad"}, {"name": "L. Lawson"}],
            "Audi": [{"name": "N. Hülkenberg"}, {"name": "G. Bortoleto"}],
            "Haas": [{"name": "E. Ocon"}, {"name": "O. Bearman"}],
            "Cadillac": [{"name": "S. Pérez"}, {"name": "V. Bottas"}],
        }}},
        {"type": "track", "template": "track", "data": {"nameKr": "헝가로링", "circuitName": "Hungaroring", "location": "헝가리 부다페스트", "lengthKm": 4.381, "laps": 70, "desc": "'담장 없는 모나코'로 불리는 좁고 굽이진 레이아웃. 직선이 짧아 추월이 어렵고 다운포스를 최대로 얹는다. 한여름 개최라 노면 온도가 높아 타이어 관리가 승부처다."}},
        {"type": "podium", "template": "podium", "data": {"season": 2025, "raceName": "Hungarian Grand Prix", "podium": [
            {"pos": 1, "name": "Lando Norris", "team": "McLaren"},
            {"pos": 2, "name": "Oscar Piastri", "team": "McLaren"},
            {"pos": 3, "name": "George Russell", "team": "Mercedes"},
        ]}},
        {"type": "stints", "template": "stints", "data": {"title": "타이어 전략 (Top 5)", "rows": [
            {"pos": 1, "code": "NOR", "stints": [{"compound": "MEDIUM", "from": 1, "to": 24}, {"compound": "HARD", "from": 25, "to": 70}]},
            {"pos": 2, "code": "HAM", "stints": [{"compound": "SOFT", "from": 1, "to": 15}, {"compound": "HARD", "from": 16, "to": 44}, {"compound": "MEDIUM", "from": 45, "to": 70}]},
            {"pos": 3, "code": "LEC", "stints": [{"compound": "MEDIUM", "from": 1, "to": 30}, {"compound": "HARD", "from": 31, "to": 70}]},
            {"pos": 4, "code": "ANT", "stints": [{"compound": "SOFT", "from": 1, "to": 18}, {"compound": "MEDIUM", "from": 19, "to": 48}, {"compound": "SOFT", "from": 49, "to": 70}]},
            {"pos": 5, "code": "VER", "stints": [{"compound": "INTERMEDIATE", "from": 1, "to": 9}, {"compound": "MEDIUM", "from": 10, "to": 41}, {"compound": "HARD", "from": 42, "to": 70}]},
        ]}},
    ],
}

def main():
    wf = json.load(open("wf2-card-renderer.json"))
    wf["id"] = "HooniWF2TestExec"
    wf["name"] = "HooniSpeed WF-2 TEST"
    wf["settings"].pop("errorWorkflow", None)
    # 트리거 교체: Webhook(메인 n8n 프로세스에서 실행) + 페이로드 주입 Code
    wf["nodes"] = [n for n in wf["nodes"] if n["type"] != "n8n-nodes-base.executeWorkflowTrigger"]
    wf["nodes"].insert(0, {"parameters": {"path": "hooni-test-wf2", "options": {}}, "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [-440, 0], "id": "e0000001-0000-4000-8000-000000000000", "name": "Webhook", "webhookId": "e0000001-0000-4000-8000-000000000000"})
    wf["nodes"].insert(1, {"parameters": {"jsCode": "return [{ json: " + json.dumps(PAYLOAD, ensure_ascii=False) + " }];"}, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [-220, 0], "id": "e0000002-0000-4000-8000-000000000000", "name": "Inject Payload"})
    del wf["connections"]["When Executed by Another Workflow"]
    wf["connections"]["Webhook"] = {"main": [[{"node": "Inject Payload", "type": "main", "index": 0}]]}
    wf["connections"]["Inject Payload"] = {"main": [[{"node": "Prepare Cards", "type": "main", "index": 0}]]}
    wf["active"] = True
    open("/tmp/wf2-test.json", "w").write(json.dumps(wf, ensure_ascii=False))
    subprocess.run(["scp", "-q", "-i", KEY, "-o", "BatchMode=yes", "/tmp/wf2-test.json", f"{HOST}:~/hooni_speed/workflows/"], check=True)
    # 임포트 → 활성화 → n8n 재시작(웹훅 등록) → 웹훅 호출
    print(subprocess.run(
        ["ssh", "-i", KEY, "-o", "BatchMode=yes", HOST,
         "sudo docker exec n8n n8n import:workflow --input=/data/hooni_speed/workflows/wf2-test.json >/dev/null 2>&1 && echo imported; "
         "sudo docker exec n8n n8n update:workflow --id=HooniWF2TestExec --active=true >/dev/null 2>&1 && echo activated; "
         "sudo docker restart n8n >/dev/null && echo restarted"],
        capture_output=True, text=True, timeout=300).stdout)
    import time
    time.sleep(50)
    print(subprocess.run(
        ["ssh", "-i", KEY, "-o", "BatchMode=yes", HOST,
         "curl -s -m 30 -o /dev/null -w 'webhook fired: %{http_code}\\n' http://localhost:5678/webhook/hooni-test-wf2"],
        capture_output=True, text=True, timeout=120).stdout)
    print("실행이 메인 n8n에서 비동기로 진행됨 — 파일 폴링으로 완료 확인 필요")

if __name__ == "__main__":
    main()
