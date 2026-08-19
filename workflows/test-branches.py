#!/usr/bin/env python3
"""WF-1 브랜치 테스트: OVERRIDE를 심은 테스트 사본을 만들어 서버에서 실행하고 Cards 출력을 확인한다."""
import json, subprocess, sys
from _env import KEY, HOST

SRC = "wf1-main-scheduler.json"
TEST_ID = "HooniWF1TestExec"

# (라벨, dayType, round) — 2026 실데이터 기준
CASES = [
    ("목 프리뷰 (더치 R12)", "preview", 12),
    ("금 가이드 (더치 R12)", "guide", 12),
    ("토 FP1·FP2 (헝가리 R11)", "practice-results", 11),
    ("일 퀄리 (헝가리 R11)", "quali-results", 11),
    ("토S FP1·SQ (중국 R2)", "sprint-fri-results", 2),
    ("일S 스프린트·퀄리 (중국 R2)", "sprint-sat-results", 2),
    ("월 총정리 (헝가리 R11)", "race-recap", 11),
]

def run(label, day_type, rnd):
    wf = json.load(open(SRC))
    wf["id"] = TEST_ID
    wf["name"] = "HooniSpeed WF-1 TEST"
    wf["settings"].pop("errorWorkflow", None)
    for node in wf["nodes"]:
        if node["name"] == "Resolve Day Type":
            node["parameters"]["jsCode"] = node["parameters"]["jsCode"].replace(
                "const OVERRIDE = null;",
                f'const OVERRIDE = {{"dayType":"{day_type}","round":"{rnd}"}};',
            )
    tmp = "/tmp/wf1-test.json"
    open(tmp, "w").write(json.dumps(wf))
    subprocess.run(["scp", "-q", "-i", KEY, "-o", "BatchMode=yes", tmp, f"{HOST}:~/hooni_speed/workflows/wf1-test.json"], check=True)
    out = subprocess.run(
        ["ssh", "-i", KEY, "-o", "BatchMode=yes", HOST,
         "sudo docker exec n8n n8n import:workflow --input=/data/hooni_speed/workflows/wf1-test.json >/dev/null 2>&1; "
         f"sudo docker exec -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n execute --id {TEST_ID} --rawOutput 2>/dev/null"],
        capture_output=True, text=True, timeout=300).stdout
    # 출력에서 실행 결과 JSON 객체를 견고하게 추출 (앞뒤 잡음/추가 텍스트 무시)
    d = None
    dec = json.JSONDecoder()
    idx = out.find('{')
    while idx >= 0:
        try:
            cand, _ = dec.raw_decode(out[idx:])
            if isinstance(cand, dict) and "data" in cand:
                d = cand
                break
        except json.JSONDecodeError:
            pass
        idx = out.find('{', idx + 1)
    if d is None:
        print(f"✗ {label}: 실행 결과 JSON 미발견 (출력 {len(out)}b)"); print(out[:300]); return False
    rd = d.get("data", {}).get("resultData", {})
    if rd.get("error"):
        print(f"✗ {label}: {rd['error'].get('message')}")
        return False
    run_data = rd.get("runData", {})
    cards_nodes = [k for k in run_data if k.endswith("Cards")]
    if not cards_nodes:
        print(f"✗ {label}: Cards 노드 미실행 (실행된 노드: {list(run_data)})"); return False
    node = cards_nodes[0]
    items = run_data[node][-1].get("data", {}).get("main", [[]])[0]
    if not items:
        print(f"✗ {label}: {node} 출력 비어있음"); return False
    payload = items[0]["json"]
    cards = payload.get("cards", [])
    summary = ", ".join(c["type"] for c in cards)
    print(f"✓ {label}: {node} → {len(cards)}장 [{summary}]")
    return payload

if __name__ == "__main__":
    results = {}
    for label, dt, rnd in CASES:
        results[dt] = run(label, dt, rnd)
    ok = sum(1 for v in results.values() if v)
    print(f"\n{ok}/{len(CASES)} 브랜치 통과")
    # 대표 케이스 상세 덤프
    if results.get("race-recap"):
        print("\n=== race-recap 상세 ===")
        print(json.dumps(results["race-recap"]["cards"], ensure_ascii=False, indent=1)[:3000])
