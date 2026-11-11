#!/usr/bin/env python3
"""Run interactively in the user's terminal; the key is never echoed."""
import argparse
import getpass
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from lockin.cloud_config import save_config,REGIONS


def main():
    parser=argparse.ArgumentParser(description='在本机隐藏输入并保存百炼按量计费密钥；不进行付费调用。')
    parser.add_argument('--region',choices=['beijing','singapore'],default='beijing')
    parser.add_argument('--model',default='qwen2.5-vl-7b-instruct')
    args=parser.parse_args()
    if not sys.stdin.isatty():
        print('请在自己的交互式终端运行；不要通过聊天、命令行参数或管道传递密钥。',file=sys.stderr)
        return 1
    print('配置仅保存到项目 backend/data/cloud-config.json，权限 600，已被 Git 忽略。')
    print('地域：'+args.region+'；模型：'+args.model)
    key=getpass.getpass('请粘贴普通 API Key 后按回车（不会显示字符）：')
    try:save_config(key,args.region,args.model)
    except ValueError as error:
        print(str(error),file=sys.stderr);return 1
    print('已保存；没有输出密钥。请告知我配置完成，我会重启后端并用合成图片验证。')
    return 0


if __name__=='__main__':raise SystemExit(main())
