#!/usr/bin/env python3
"""테스트 스크립트 공용 서버 접속 설정. 실제 값은 환경변수로만 받는다 (.env.example 참고)."""
import os, sys


def _req(name):
    v = os.environ.get(name)
    if not v:
        sys.exit(f"환경변수 {name} 가 필요하다. 저장소 루트의 .env.example 참고.")
    return v


KEY = _req("N8N_SSH_KEY")    # SSH 개인키 파일 경로
HOST = _req("N8N_SSH_HOST")  # ubuntu@<서버주소>
