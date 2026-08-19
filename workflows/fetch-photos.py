#!/usr/bin/env python3
"""F1 공식 드라이버 포트레이트 수집 + 얼굴 크롭 → /tmp/f1ref/faces/<code>.png
공식 이미지는 프레이밍이 일정하므로 비율 기반 크롭이 통한다."""
import os, subprocess, sys
from PIL import Image

OUT = "/tmp/f1ref/faces"
RAW = "/tmp/f1ref/raw"
os.makedirs(OUT, exist_ok=True)
os.makedirs(RAW, exist_ok=True)

# 2026 그리드 22명: 코드 → 성(파일명)
DRIVERS = {
    "nor": "norris", "pia": "piastri", "lec": "leclerc", "ham": "hamilton",
    "rus": "russell", "ant": "antonelli", "ver": "verstappen", "had": "hadjar",
    "alo": "alonso", "str": "stroll", "gas": "gasly", "col": "colapinto",
    "sai": "sainz", "alb": "albon", "hul": "hulkenberg", "bor": "bortoleto",
    "oco": "ocon", "bea": "bearman", "lin": "lindblad", "law": "lawson",
    "per": "perez", "bot": "bottas",
}
BASE = "https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_1320/content/dam/fom-website/drivers"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

# 얼굴 영역 (이미지 크기 대비 비율) — 공식 포트레이트 공통 프레이밍
FX0, FY0, FX1, FY1 = 0.32, 0.03, 0.69, 0.41

def try_download(code, last):
    for year in ("2025Drivers", "2024Drivers", "2026Drivers"):
        path = f"{RAW}/{code}.img"
        r = subprocess.run(["curl", "-sL", "-m", "25", "-A", UA, "-o", path, f"{BASE}/{year}/{last}"],
                           capture_output=True)
        if os.path.exists(path) and os.path.getsize(path) > 30000:
            try:
                im = Image.open(path)
                im.verify()
                return path, year
            except Exception:
                pass
    return None, None

ok, fail = [], []
for code, last in DRIVERS.items():
    path, year = try_download(code, last)
    if not path:
        fail.append(code)
        print(f"✗ {code} ({last}) — 사진 없음")
        continue
    im = Image.open(path).convert("RGB")
    w, h = im.size
    box = (int(w * FX0), int(h * FY0), int(w * FX1), int(h * FY1))
    im.crop(box).resize((720, 720)).save(f"{OUT}/{code}.png")
    ok.append(code)
    print(f"✓ {code} ({last}) {w}x{h} [{year}]")

print(f"\n성공 {len(ok)}/{len(DRIVERS)}: {' '.join(ok)}")
if fail:
    print(f"실패 {len(fail)}: {' '.join(fail)} → 텍스트 설명만으로 생성 필요")
