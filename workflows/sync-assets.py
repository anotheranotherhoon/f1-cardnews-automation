#!/usr/bin/env python3
"""서버에서 생성된 캐릭터 자산을 저장소로 가져온다.

n8n 은 git 을 모른다. 자산 승인 게이트(WF-1)가 만든 캐릭터는 **서버에만** 남으므로,
이 스크립트로 저장소에 반영한 뒤 커밋해야 원격 백업이 된다. 서버는 프리티어 VM 하나뿐이다.

  python3 sync-assets.py             # 차이만 보여준다 (기본: 미적용)
  python3 sync-assets.py --apply     # 서버에만 있는 신규 파일을 내려받는다
  python3 sync-assets.py --apply --overwrite   # 내용이 다른 파일까지 덮어쓴다 (주의)

**내용이 다른 파일은 기본적으로 가져오지 않는다.** dotd 자산은 저장소가 원본(약 2MB),
서버가 서빙용 경량화 사본(약 0.8MB)이라 그냥 당겨오면 원본이 압축본으로 덮어써진다.
가져와야 할 것은 "서버에서 새로 생성된 자산"뿐이다.

저장소에만 있는 파일은 건드리지 않는다 (삭제 동기화 없음).
"""
import os
import subprocess
import sys

from _env import KEY, HOST

REMOTE_DIRS = ['assets', 'cards/dotd']  # 캐릭터 base / DOTD 포즈
# 워크플로가 쓰는 /data/... 는 컨테이너 경로다. 호스트에서는 아래 경로로 마운트되어 있다.
HOST_PATHS = {
    'assets': '/home/ubuntu/hooni_speed/assets',
    'cards/dotd': '/home/ubuntu/flutter-web/web/hooni-cards/dotd',
}
LOCAL_PATHS = {
    'assets': os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets'),
    'cards/dotd': os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'dotd'),
}

SSH = ['ssh', '-i', KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=25', HOST]


# meme/ 은 라운드별 스토리 이미지다 — WF-6 이 매 경기 새로 만드는 산출물이라
# 재사용 자산이 아니고, 동기화하면 저장소가 경기마다 불어난다.
EXCLUDE_TOP = {'meme'}


def is_junk(rel):
    """자산이 아닌 것: 맥 전송 부산물('._x.png'), 라운드별 산출물."""
    parts = rel.split('/')
    return any(p.startswith('._') for p in parts) or parts[0] in EXCLUDE_TOP


def remote_index(path):
    """{상대경로: md5} — 서버의 png 목록."""
    cmd = f"cd {path} 2>/dev/null && find . -name '*.png' -type f -exec md5sum {{}} + 2>/dev/null || true"
    out = subprocess.run(SSH + [cmd], capture_output=True, text=True, timeout=180).stdout
    idx = {}
    for line in out.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2:
            rel = parts[1].strip().lstrip('./')
            if not is_junk(rel):
                idx[rel] = parts[0]
    return idx


def local_index(path):
    import hashlib

    idx = {}
    if not os.path.isdir(path):
        return idx
    for root, _dirs, files in os.walk(path):
        for f in files:
            if not f.endswith('.png'):
                continue
            fp = os.path.join(root, f)
            rel = os.path.relpath(fp, path)
            with open(fp, 'rb') as fh:
                idx[rel] = hashlib.md5(fh.read()).hexdigest()
    return idx


def main():
    apply = '--apply' in sys.argv
    overwrite = '--overwrite' in sys.argv
    total_new = total_diff = 0

    for key in REMOTE_DIRS:
        hp, lp = HOST_PATHS[key], os.path.normpath(LOCAL_PATHS[key])
        print(f'=== {key}  (서버 {hp})')
        rem = remote_index(hp)
        loc = local_index(lp)
        new = sorted(k for k in rem if k not in loc)
        diff = sorted(k for k in rem if k in loc and rem[k] != loc[k])
        print(f'  서버 {len(rem)}개 · 로컬 {len(loc)}개 · 신규 {len(new)}개 · 내용다름 {len(diff)}개')
        for k in new:
            print(f'    + {k}   (신규)')
        for k in diff:
            print(f'    ~ {k}   (내용다름 — 기본 제외)')
        total_new += len(new)
        total_diff += len(diff)

        take = new + (diff if overwrite else [])
        if apply and take:
            for k in take:
                dest = os.path.join(lp, k)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                subprocess.run(
                    ['scp', '-q', '-i', KEY, '-o', 'BatchMode=yes', f'{HOST}:{hp}/{k}', dest],
                    check=True, timeout=180,
                )
            print(f'  → {len(take)}개 내려받음')
        elif apply and diff and not overwrite:
            print(f'  → 신규 0개. 내용다름 {len(diff)}개는 건너뜀 (덮어쓰려면 --overwrite)')

    print()
    if total_new == 0 and total_diff == 0:
        print('서버에 새로 생긴 자산이 없다.')
        return
    if total_diff:
        print(f'내용다름 {total_diff}개 — dotd 는 저장소가 원본이고 서버가 경량화 사본이다. 정상이다.')
    if total_new == 0:
        print('가져올 신규 자산은 없다.')
    elif apply:
        print(f'신규 {total_new}개 반영 완료. 커밋하면 원격에 백업된다:')
        print('  git status --short assets/')
        print('  git add assets/ && git commit -m "캐릭터 자산 동기화" && git push')
    else:
        print(f'신규 {total_new}개. 가져오려면: python3 sync-assets.py --apply')


if __name__ == '__main__':
    main()
