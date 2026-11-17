#!/usr/bin/env python3
"""One consented cloud-model check using only our synthetic teaching fixture."""
import base64
import json
from pathlib import Path
import sys
import time
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from lockin.providers import configured_screen


def main():
    provider=configured_screen()
    if not provider.status()['configured']:
        print('尚未配置，请先配置视觉模型服务。');return 1
    fixture=ROOT/'backend/tests/fixtures/study-screen.png'
    image='data:image/png;base64,'+base64.b64encode(fixture.read_bytes()).decode()
    started=time.monotonic()
    result=provider.classify(image,'Understand how to calculate the arithmetic mean')
    print(json.dumps({'provider':provider.status(),'latency_s':round(time.monotonic()-started,2),
                     'test_input':'synthetic arithmetic lesson; no user camera/screen data',
                     'result':result.model_dump()},ensure_ascii=False,indent=2))
    return 0 if result.kind=='study' and result.task_related and result.confidence>=.75 else 1


if __name__=='__main__':raise SystemExit(main())
