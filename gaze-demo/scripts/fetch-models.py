#!/usr/bin/env python3
"""Fetch only pinned public face/gaze/expression weights, verifying exact bytes and hashes.

Existing valid local files are reused without network requests. Total payload <40MB.
FER+ predicts facial expression, not pressure. No pressure classifier is implied.
"""
from pathlib import Path
import hashlib
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
ASSETS=[('public/models/emotion-ferplus-8.onnx',35040571,'a2a2ba6a335a3b29c21acb6272f962bd3d47f84952aaffa03b60986e04efa61c',
    'https://media.githubusercontent.com/media/onnx/models/4c46cd00fbdb7cd30b6c1c17ab54f2e1f4f7b177/validated/vision/body_analysis/emotion_ferplus/model/emotion-ferplus-8.onnx'),('public/face_landmarker.task',3758596,'64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'),
    ('public/web/group1-shard1of1.bin',624072,'c030a762a2d21ac0f3c59700a723b2d8790f2003b3f8e72fbe31129fcb234e58',
    'https://raw.githubusercontent.com/RedForestAI/WebEyeTrack/75fbd2f5f784f2eb3a39675a8dcbf1b01c697f1c/js/examples/demo-app/public/web/group1-shard1of1.bin')]


def main():
    for relative,size,digest,url in ASSETS:
        path=ROOT/relative
        if path.is_file() and path.stat().st_size==size and hashlib.sha256(path.read_bytes()).hexdigest()==digest:
            print(relative+': existing verified asset');continue
        with urllib.request.urlopen(url,timeout=60) as response:
            content=response.read(size+1)
        if len(content)!=size or hashlib.sha256(content).hexdigest()!=digest:raise ValueError('asset size/hash mismatch: '+relative)
        path.parent.mkdir(parents=True,exist_ok=True)
        temporary=path.with_suffix(path.suffix+'.part');temporary.write_bytes(content);temporary.replace(path)
        print(relative+': downloaded and verified')


if __name__=='__main__':main()
