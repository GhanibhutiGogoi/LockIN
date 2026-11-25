import json

import httpx
from fastapi.testclient import TestClient

from lockin.app import create_app
from lockin.memory import Memory
from lockin.screen_activity import ActivityInput, ActivityModel, content_blocks, document_text, model_blocks, prompt_cost


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
    assert content_blocks('http：//127.0.0.1:5181正在共享您的屏幕.\n停止分享\n扫描件编辑\nOutlier Detection') == ['Outlier Detection']


def test_long_ocr_prompts_keep_original_ids_with_bounded_input():
    blocks = ['Course title', 'Outliers'] + [f'{i}: ' + 'Substantive lesson text. ' * 5 for i in range(30)]
    selected = model_blocks(blocks)
    assert sum(len(block['text']) + 12 for block in selected) <= 1100
    assert selected[0] == {'id': 0, 'text': blocks[0]}
    assert all(block['text'] == blocks[block['id']] for block in selected)


def test_chinese_video_pages_have_a_token_budget_not_an_english_character_budget():
    blocks = ['纪录片推荐', '热门视频'] + [f'{i}：探访世界各地的美食与旅行故事，记录普通人的生活。' for i in range(40)]
    selected = model_blocks(blocks)
    assert sum(prompt_cost(b['text']) + 12 for b in selected) <= 320
    assert 2 <= len(selected) < 10
    assert all(b['text'] == blocks[b['id']] for b in selected)
    assert content_blocks('番剧直播游戏中心会员购漫画赛事下载客户端\n2万点赞某个用户\n这是一档探索世界各地美食与文化的旅行纪录片') == ['这是一档探索世界各地美食与文化的旅行纪录片']
    long = '这是一段讲解异常值检测和数据挖掘课程概念的正文。' * 8
    assert long.startswith(model_blocks([long])[0]['text'])
    assert prompt_cost(model_blocks([long])[0]['text']) <= 160


def test_timeout_is_reported_separately_from_other_model_failures():
    def timeout(request):
        raise httpx.ReadTimeout('inference deadline', request=request)
    result = ActivityModel('http://127.0.0.1:8005/v1/chat/completions', httpx.MockTransport(timeout)).analyze(GOAL, TEXT)
    assert result['reason'] == 'model-timeout'


def test_descriptive_chinese_video_titles_do_not_require_a_long_prose_paragraph():
    def send(request):
        blocks = json.loads(json.loads(request.content)['messages'][1]['content'])['blocks']
        return httpx.Response(200, json={'model': 'lockin-screen-activity', 'choices': [
            {'finish_reason': 'stop', 'message': {'content': json.dumps({'label': 'off-topic', 'block_ids': [blocks[0]['id']]})}}
        ]})
    result = ActivityModel('http://127.0.0.1:8005/v1/chat/completions', httpx.MockTransport(send)).analyze(
        'outlier in data mining', '谁能锻造最强武器？\n冥王星的前世今生\n理想主义帝王的幻灭')
    assert result['label'] == 'off-topic'


def test_route_handles_empty_text_and_unavailable_model(tmp_path, monkeypatch):
    monkeypatch.setenv('LOCKIN_SCREEN_ACTIVITY_URL', '')
    client = TestClient(create_app(tmp_path / 'activity.sqlite', memory=Memory()))
    path = '/v1/web-screen/activity'
    headers = {'Origin': 'http://localhost:5180'}
    assert client.post(path, json={'goal': GOAL, 'text': ''}, headers=headers).json() == {'label': 'uncertain'}
    assert client.post(path, json={'goal': GOAL, 'text': TEXT}, headers=headers).json()['label'] == 'unavailable'
    assert client.post(path, json={'goal': GOAL, 'text': TEXT}, headers={'Origin': 'https://example.org'}).status_code == 403
    assert client.post(path, json={'goal': ' ', 'text': TEXT}, headers=headers).status_code == 422


def test_unopened_inbox_abstains_even_if_model_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv('LOCKIN_SCREEN_ACTIVITY_URL', '')
    client = TestClient(create_app(tmp_path / 'inbox.sqlite', memory=Memory()))
    for text in ('Gmail\nInbox\nCompose\nStarred\n21 unread',
                 'Inbox\nSummer sale starts tonight\nGroup dinner time\nYour parcel arrives tomorrow',
                 '收件箱\n筛选\n搜索邮件\n星标\n草稿\n全部标记为已读'):
        assert client.post('/v1/web-screen/activity', json={'goal': GOAL, 'text': text}).json() == {'label': 'uncertain'}


def box(text, y, x=400):
    return {'text': text, 'confidence': .95,
            'polygon': [[x, y], [x + 200, y], [x + 200, y + 18], [x, y + 18]]}


def layout(blocks):
    return {'goal': 'Data Mining course: outlier', 'text': '\n'.join(b['text'] for b in blocks),
            'blocks': blocks, 'image': {'width': 1600, 'height': 1000}}


def test_wps_tabs_do_not_reach_classifier_or_recap_text(tmp_path, monkeypatch):
    # The lesson name is an inactive WPS tab; the visible body describes a university.
    blocks = [box('L9-outlier', 36), box('Resume', 36, 700), box('WPSAI', 69),
              box('阅读模式', 134), box('Graduate admissions', 277),
              box('International students can apply for our graduate degree programmes.', 316)]
    captured = []

    def send(request):
        supplied = json.loads(json.loads(request.content)['messages'][1]['content'])['blocks']
        captured.append(supplied)
        assert [b['text'] for b in supplied] == [b['text'] for b in blocks[4:]]
        return httpx.Response(200, json={'model': 'lockin-screen-activity', 'choices': [
            {'finish_reason': 'stop', 'message': {'content': '{"label":"related","block_ids":[1]}'}}
        ]})

    local_model = ActivityModel('http://127.0.0.1:8005/v1/chat/completions', httpx.MockTransport(send))
    monkeypatch.setattr('lockin.screen_activity.ActivityModel', lambda url: local_model)
    client = TestClient(create_app(tmp_path / 'layout.sqlite', memory=Memory()))
    result = client.post('/v1/web-screen/activity', json=layout(blocks)).json()
    assert captured
    # Even a model's mistaken related decision cannot put tab text into a recap.
    assert result['studyText'] == '\n'.join(b['text'] for b in blocks[4:])
    assert result['evidence'][0]['text'] == blocks[5]['text']
    assert result['contentFilter']['excludedBlocks'] == 4


def test_body_titles_survive_header_filter_at_different_scales():
    for scale in (1, .5):
        blocks = [box('L9-outlier', 8), box('WPSAI', 38), box('旋转文档', 106),
                  box('Outlier Detection versus Clustering', 150),
                  box('Outlier detection finds exceptional cases that deviate from majority patterns.', 296)]
        payload = layout(blocks)
        for b in blocks:
            b['polygon'] = [[x * scale, y * scale] for x, y in b['polygon']]
        payload['image'] = {'width': int(1600 * scale), 'height': int(1000 * scale)}
        text, filtering = document_text(ActivityInput.model_validate(payload))
        assert text.splitlines() == [b['text'] for b in blocks[3:]]
        assert filtering['excludedBlocks'] == 3


def test_fullscreen_heading_is_not_removed_by_a_fixed_top_crop():
    blocks = [box('Outlier Detection', 15), box('Gaze tracking active', 60),
              box('An outlier deviates significantly from the remaining data points.', 180)]
    text, filtering = document_text(ActivityInput.model_validate(layout(blocks)))
    assert 'Outlier Detection' in text
    assert 'Gaze tracking active' not in content_blocks(text)
    assert filtering['headerBottomRatio'] == 0


def test_browser_tab_row_and_address_bar_are_not_document_content():
    for controls in ([box('×', 20), box('+', 20, 900)], [box('https://example.edu/admissions', 60)]):
        blocks = [box('Outlier Detection', 20), *controls,
                  box('Graduate admissions requirements and application deadlines.', 180)]
        text, _ = document_text(ActivityInput.model_validate(layout(blocks)))
        assert text == blocks[-1]['text']


def test_empty_or_out_of_frame_layout_does_not_restore_unfiltered_tab_text():
    for blocks in ([], [box('L9-outlier', 1200)]):
        payload = layout(blocks)
        payload['text'] = 'L9-outlier\nDo not restore this unfiltered input when no body was found.'
        assert document_text(ActivityInput.model_validate(payload))[0] == ''


def test_legacy_text_only_ocr_still_works():
    assert document_text(ActivityInput(goal=GOAL, text=TEXT)) == (
        TEXT, {'method': 'text-only', 'excludedBlocks': 0})


def test_layout_preserves_chinese_inbox_guard(tmp_path, monkeypatch):
    monkeypatch.setenv('LOCKIN_SCREEN_ACTIVITY_URL', '')
    client = TestClient(create_app(tmp_path / 'inbox-layout.sqlite', memory=Memory()))
    payload = layout([box('https://mail.example.edu', 30), box('收件箱', 180),
                      box('This unopened message advertises a shopping promotion.', 240)])
    assert client.post('/v1/web-screen/activity', json=payload).json() == {'label': 'uncertain'}


def test_open_email_uses_reading_pane_instead_of_controls_or_other_messages():
    blocks = [box('https://outlook.office365.com/mail', 40),
              box('Delete Archive', 220), box('Unread', 260),
              box('Outlier Detection course project', 440, 120),
              box('PG Online Admissions System', 490, 120),
              box('University Forum: HydroGym flow-control priors', 330, 650),
              box('Summarize this email', 380, 650),
              box('In this talk I present reinforcement learning for fluid flow control.', 430, 650)]
    text, filtering = document_text(ActivityInput.model_validate(layout(blocks)))
    assert text.splitlines() == [blocks[5]['text'], blocks[7]['text']]
    assert filtering['readingPane'] is True
    assert filtering['excludedBlocks'] == 6
    assert content_blocks('Delete Archive\nUnread\nReport\n' + text) == text.splitlines()
