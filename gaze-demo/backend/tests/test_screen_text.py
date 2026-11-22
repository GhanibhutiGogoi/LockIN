from fastapi.testclient import TestClient

from lockin import screen_text
from lockin.app import create_app
from lockin.memory import Memory


def test_shared_screen_ocr_accepts_only_local_jpeg(tmp_path, monkeypatch):
    seen = []

    def recognize(frame):
        seen.append(frame)
        return ['Screen text', '中文内容']

    monkeypatch.setattr(screen_text, 'recognize_screen_text', recognize)
    client = TestClient(create_app(tmp_path / 'screen.sqlite', memory=Memory()))
    path = '/v1/web-screen/text'
    headers = {'content-type': 'image/jpeg', 'origin': 'http://localhost:5180'}
    frame = b'\xff\xd8\xff\xe0synthetic'
    assert client.post(path, content=frame, headers=headers).json() == {'lines': ['Screen text', '中文内容']}
    assert client.post(path, content=frame, headers={**headers, 'origin': 'https://example.org'}).status_code == 403
    assert client.post(path, content=b'other', headers=headers).status_code == 422
    assert client.post(path, content=frame, headers={'content-type': 'text/plain'}).status_code == 415
    assert client.post(path, content=frame + b'x' * 1_500_000, headers=headers).status_code == 413
    assert seen == [frame]
