"""Exercise real OCR, relevance, script, narration and video APIs with synthetic text."""
import argparse
import io
import json
from pathlib import Path
import time

import httpx
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--voice-url', required=True)
    args = parser.parse_args()
    results = {}
    with httpx.Client(timeout=420, trust_env=False) as client:
        def post(name, url, **kwargs):
            started = time.monotonic()
            response = client.post(url, **kwargs)
            if response.is_error:
                raise RuntimeError(f'{name}: HTTP {response.status_code}: {response.text[:800]}')
            value = response.json()
            results[name] = {'seconds': round(time.monotonic() - started, 2), 'result': value}
            print(f'{name}: OK in {results[name]["seconds"]}s', flush=True)
            return value

        image = Image.new('RGB', (1280, 720), 'white')
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 34)
        lines = ['Data Mining / 数据挖掘', 'Outlier detection identifies unusual observations.',
                 'A boxplot shows the median and interquartile range.',
                 'The interquartile range is Q3 minus Q1.',
                 'An outlier may fall beyond 1.5 times this range.']
        for i, line in enumerate(lines):
            draw.text((45, 65 + i * 95), line, fill='black', font=font)
        buffer = io.BytesIO(); image.save(buffer, format='JPEG')
        ocr = post('ocr', 'http://127.0.0.1:8000/v1/web-screen/text',
                   content=buffer.getvalue(), headers={'Content-Type': 'image/jpeg'})
        text = '\n'.join(ocr['lines'])
        assert 'Outlier' in text and '数据' in text, text
        goal = 'Study data mining and outlier detection'
        related = post('related', 'http://127.0.0.1:8000/v1/web-screen/activity', json={'goal': goal, 'text': text})
        assert related['label'] == 'related', related
        off_topic = post('off-topic', 'http://127.0.0.1:8000/v1/web-screen/activity', json={
            'goal': goal, 'text': 'Shopping cart\nSummer dresses 50 percent off. Buy two shirts. Checkout with your credit card.'})
        assert off_topic['label'] == 'off-topic', off_topic
        post('connection', 'http://127.0.0.1:8013/connection', json={'voice_url': args.voice_url})
        variant = {'id': 'screen-flow-check', 'target_seconds': 30, 'slang_level': 'plain',
                   'humour_style': 'memes', 'recap_or_preview': 'recap', 'quiz_count': 1,
                   'voice_id': 'chill', 'pacing': 1.0, 'gameplay_type': 'auto'}
        script = post('script', 'http://127.0.0.1:8013/scripts', json={
            'slide': {'title': 'Integration test: Data mining', 'text': text}, 'variant': variant, 'depth': 1})
        assert len(script['quiz']) == 1
        media = post('media', 'http://127.0.0.1:8013/media', json={
            'deck_id': 'screen-flow-check', 'slide_index': 0, 'script': script,
            'variant': variant, 'voice_url': args.voice_url})
        response = client.get('http://127.0.0.1:8013/' + media['video_url'])
        response.raise_for_status()
        assert len(response.content) > 100_000 and media['duration_sec'] > 0
        output = ROOT / '.runtime/windows/full-flow.json'
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'PASS: real bilingual OCR -> relevance -> script/question -> narration -> playable MP4. Evidence: {output}', flush=True)


if __name__ == '__main__':
    main()
