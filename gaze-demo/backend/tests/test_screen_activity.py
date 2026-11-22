import json

import httpx
from fastapi.testclient import TestClient

from lockin.app import create_app
from lockin.memory import Memory
from lockin.screen_activity import ActivityModel, content_blocks, model_blocks


GOAL = 'Review HCI usability testing'
TEXT = 'NBA highlights\nWatch the latest game highlights and standings'


def model(decision):
    def send(request):
        payload = json.loads(request.content)
        assert json.loads(payload['messages'][1]['content']) == {'goal': GOAL,
            'blocks': [{'id': i, 'text': t} for i, t in enumerate(content_blocks(TEXT))]}
        assert request.url.host == '127.0.0.1'
        return httpx.Response(200, json={'model': 'lockin-screen-activity', 'choices': [
            {'finish_reason': 'stop', 'message': {'content': json.dumps(decision)}}
        ]})
    return ActivityModel('http://127.0.0.1:8005/v1/chat/completions', httpx.MockTransport(send))


def test_screen_activity_only_accepts_grounded_off_topic_evidence():
    result = model({'label': 'off-topic', 'block_ids': [1]}).analyze(GOAL, TEXT)
    assert result['label'] == 'off-topic'
    assert result['evidence'] == [{'id': 1, 'text': TEXT.splitlines()[1]}]
    assert model({'label': 'off-topic', 'block_ids': [99]}).analyze(GOAL, TEXT)['reason'] == 'invalid-evidence-ids'
    assert model({'label': 'off-topic', 'block_ids': [-1]}).classify(GOAL, TEXT) == 'uncertain'
    assert model({'label': 'off-topic', 'block_ids': []}).classify(GOAL, TEXT) == 'uncertain'


def test_navigation_and_tracking_are_not_recap_material():
    text = 'LockIn Screen Study\nStudy goal Data Mining course: outlier\nTracking interrupted\nL9-outlier.pdf\nSelect a file\n0:13'
    assert ActivityModel('http://127.0.0.1:8005/v1/chat/completions').analyze(GOAL, text)['reason'] == 'insufficient-content'
    assert content_blocks('Looking away 30 /30 s\nBoxplot Visualization\nThe lower quartile (Q1)') == ['Boxplot Visualization', 'The lower quartile (Q1)']


def test_long_ocr_prompts_keep_original_ids_with_bounded_input():
    blocks = ['Course title', 'Outliers'] + [f'{i}: ' + 'Substantive lesson text. ' * 5 for i in range(30)]
    selected = model_blocks(blocks)
    assert sum(len(block['text']) + 12 for block in selected) <= 1100
    assert selected[0] == {'id': 0, 'text': blocks[0]}
    assert all(block['text'] == blocks[block['id']] for block in selected)


def test_route_handles_empty_text_and_unavailable_model(tmp_path, monkeypatch):
    monkeypatch.setenv('LOCKIN_SCREEN_ACTIVITY_URL', '')
    client = TestClient(create_app(tmp_path / 'activity.sqlite', memory=Memory()))
    path = '/v1/web-screen/activity'
    headers = {'Origin': 'http://localhost:5180'}
    assert client.post(path, json={'goal': GOAL, 'text': ''}, headers=headers).json() == {'label': 'uncertain'}
    assert client.post(path, json={'goal': GOAL, 'text': TEXT}, headers=headers).json() == {'label': 'unavailable'}
    assert client.post(path, json={'goal': GOAL, 'text': TEXT}, headers={'Origin': 'https://example.org'}).status_code == 403
    assert client.post(path, json={'goal': ' ', 'text': TEXT}, headers=headers).status_code == 422


def test_unopened_inbox_abstains_even_if_model_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv('LOCKIN_SCREEN_ACTIVITY_URL', '')
    client = TestClient(create_app(tmp_path / 'inbox.sqlite', memory=Memory()))
    for text in ('Gmail\nInbox\nCompose\nStarred\n21 unread',
                 'Inbox\nSummer sale starts tonight\nGroup dinner time\nYour parcel arrives tomorrow',
                 '收件箱\n筛选\n搜索邮件\n星标\n草稿\n全部标记为已读'):
        assert client.post('/v1/web-screen/activity', json={'goal': GOAL, 'text': text}).json() == {'label': 'uncertain'}
