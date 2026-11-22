"""Private local credential configuration; never sent to the browser or exports."""
import json
import os
from pathlib import Path
import re
import tempfile

DEFAULT_PATH=Path(__file__).resolve().parents[1]/'data/cloud-config.json'
REGIONS={'beijing':'https://dashscope.aliyuncs.com/compatible-mode/v1',
         'singapore':'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
         'nvidia':'https://integrate.api.nvidia.com/v1'}


def validate(api_key,region,model):
    key=api_key.strip() if isinstance(api_key,str) else ''
    if region not in REGIONS:raise ValueError('不支持的模型服务；请选择 beijing、singapore 或 nvidia。')
    if region=='nvidia':
        valid=key.startswith('nvapi-')
    else:
        valid=key.startswith('sk-') and not key.startswith('sk-sp-')
    if not valid or any(c.isspace() for c in key):
        raise ValueError('API Key 格式与所选服务不匹配；百炼需普通按量计费密钥，NVIDIA 需 nvapi- 密钥。')
    if not isinstance(model,str) or not re.fullmatch(r'[A-Za-z0-9._/-]{1,128}',model):raise ValueError('模型名称无效。')
    return {'api_key':key,'region':region,'model':model}


def save_config(api_key,region,model,path=DEFAULT_PATH):
    config=validate(api_key,region,model)
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(prefix='.cloud-',dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w') as f:
            json.dump(config,f);f.flush();os.fsync(f.fileno())
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def load_config():
    path=Path(os.getenv('LOCKIN_CLOUD_CONFIG',str(DEFAULT_PATH)))
    if not path.exists():return None
    try:
        if path.stat().st_mode & 0o077:raise ValueError('配置文件必须仅当前用户可读写（chmod 600）。')
        data=json.loads(path.read_text())
        if not isinstance(data,dict) or set(data)!={'api_key','region','model'}:raise ValueError('本机云端配置格式无效。')
        return validate(data['api_key'],data['region'],data['model'])
    except (OSError,json.JSONDecodeError) as error:
        raise ValueError('无法读取本机云端配置；请重新运行配置脚本。') from None
