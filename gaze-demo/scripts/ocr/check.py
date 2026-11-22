"""Exercise the real OCR HTTP endpoint with English, Chinese, and blank images."""
import argparse
import io
import json
from pathlib import Path
import time

import httpx
from PIL import Image, ImageDraw, ImageFont


def jpeg(lines, font, size=(1280, 720), spacing=95):
    image = Image.new('RGB', size, 'white')
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(lines):
        draw.text((60, 60 + index * spacing), line, fill='black', font=font)
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=90)
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    parser.add_argument('--font', default='C:/Windows/Fonts/msyh.ttc')
    parser.add_argument('--image', help='Optional real document screenshot for local verification.')
    parser.add_argument('--expect', help='Text required in the screenshot OCR result.')
    parser.add_argument('--repeat', type=int, default=3)
    args = parser.parse_args()
    if not Path(args.font).is_file():
        parser.error('Pass --font with a Chinese-capable local font file.')
    font = ImageFont.truetype(args.font, 44)
    with httpx.Client(base_url=args.url, timeout=40, trust_env=False) as client:
        deadline = time.monotonic() + 120
        while True:
            health = client.get('/v1/web-screen/status').raise_for_status().json()
            if health['status'] == 'ready':
                break
            if health['status'] not in ('loading', 'recovering') or time.monotonic() >= deadline:
                raise RuntimeError(health)
            print('Waiting for OCR warmup...', flush=True)
            time.sleep(2)
        chinese = '\u6570\u636e\u6316\u6398'
        lines = ['Data Mining', 'Outlier detection and clustering', chinese,
                 '\u5f02\u5e38\u503c\u68c0\u6d4b\u4e0e\u805a\u7c7b\u5206\u6790']
        response = client.post('/v1/web-screen/text', content=jpeg(lines, font),
                               headers={'content-type': 'image/jpeg', 'origin': 'http://localhost:5181'})
        response.raise_for_status()
        result = response.json()
        text = '\n'.join(result['lines'])
        assert 'Data Mining' in text and chinese in text, result
        assert len(result['blocks']) == len(result['lines'])
        assert result['image'] == {'width': 1280, 'height': 720}
        print(json.dumps(result, ensure_ascii=True, indent=2), flush=True)
        dense = client.post('/v1/web-screen/text',
                            content=jpeg([f'{index + 1}. Data Mining: {chinese} - clustering and regression'
                                          for index in range(24)], ImageFont.truetype(args.font, 28),
                                         size=(1920, 1080), spacing=40),
                            headers={'content-type': 'image/jpeg'}).raise_for_status().json()
        assert len(dense['lines']) >= 20, dense
        print(f"Dense page: {len(dense['lines'])} lines, {dense['durationMs']} ms", flush=True)
        blank = client.post('/v1/web-screen/text', content=jpeg([], font),
                            headers={'content-type': 'image/jpeg'}).raise_for_status().json()
        assert blank['status'] == 'no-text' and blank['lines'] == [], blank
        invalid = client.post('/v1/web-screen/text', content=b'\xff\xd8\xffinvalid',
                              headers={'content-type': 'image/jpeg'})
        assert invalid.status_code == 422, invalid.text
        assert client.get('/v1/web-screen/status').json()['status'] == 'ready'
        if args.image:
            with Image.open(args.image) as source:
                image = source.convert('RGB')
            image.thumbnail((1920, 1920))
            buffer = io.BytesIO()
            image.save(buffer, format='JPEG', quality=80)
            for attempt in range(args.repeat):
                result = client.post('/v1/web-screen/text', content=buffer.getvalue(),
                                     headers={'content-type': 'image/jpeg'}).raise_for_status().json()
                assert result['lines'], result
                if args.expect:
                    assert args.expect in '\n'.join(result['lines']), result
                print(f"Screenshot {attempt + 1}: {len(result['lines'])} lines, {result['durationMs']} ms", flush=True)
            print(json.dumps(result['lines'], ensure_ascii=True), flush=True)
        print('PASS: English, Chinese, dense page, blank frame, invalid JPEG, and port 5181 origin.', flush=True)


if __name__ == '__main__':
    main()
