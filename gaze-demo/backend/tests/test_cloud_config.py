import json
import os
import pytest
from lockin.cloud_config import save_config
from lockin.providers import configured_screen


def test_saved_local_key_is_private_and_overrides_stale_environment(tmp_path,monkeypatch):
    path=tmp_path/'data'/'cloud-config.json'
    save_config(' sk-test-fixture-only ','beijing','qwen2.5-vl-7b-instruct',path)
    assert path.stat().st_mode & 0o777 == 0o600
    monkeypatch.setenv('LOCKIN_CLOUD_CONFIG',str(path))
    monkeypatch.setenv('LOCKIN_VLM_API_KEY','stale-fixture')
    provider=configured_screen()
    assert provider.key=='sk-test-fixture-only'
    assert provider.base_url=='https://dashscope.aliyuncs.com/compatible-mode/v1'
    assert 'sk-test-fixture-only' not in json.dumps(provider.status())


@pytest.mark.parametrize('key',['','not-a-key','sk-sp-plan-only','sk-test\nother=value'])
def test_invalid_key_never_replaces_saved_configuration(tmp_path,key):
    path=tmp_path/'cloud.json';path.write_text('existing configuration')
    with pytest.raises(ValueError):save_config(key,'beijing','qwen-vl-plus',path)
    assert path.read_text()=='existing configuration'


def test_region_pair_is_stored_together(tmp_path,monkeypatch):
    path=tmp_path/'cloud.json';save_config('sk-test-fixture','singapore','qwen-vl-plus',path)
    monkeypatch.setenv('LOCKIN_CLOUD_CONFIG',str(path))
    assert configured_screen().base_url=='https://dashscope-intl.aliyuncs.com/compatible-mode/v1'


def test_malformed_local_config_fails_closed_without_echoing_key(tmp_path,monkeypatch):
    path=tmp_path/'cloud.json';path.write_text('{"api_key":"sk-private-fixture", "region":"unknown"}')
    os.chmod(path,0o600);monkeypatch.setenv('LOCKIN_CLOUD_CONFIG',str(path))
    with pytest.raises(ValueError) as error:configured_screen()
    assert 'sk-private-fixture' not in str(error.value)


def test_nvidia_configuration_uses_existing_credential_format(tmp_path,monkeypatch):
    path=tmp_path/'cloud.json'
    save_config('nvapi-fixture-only','nvidia','nvidia/nemotron-3.5-super-vl-120b-a12b',path)
    monkeypatch.setenv('LOCKIN_CLOUD_CONFIG',str(path))
    provider=configured_screen()
    assert provider.base_url=='https://integrate.api.nvidia.com/v1'
    assert provider.model=='nvidia/nemotron-3.5-super-vl-120b-a12b'
    assert provider.key=='nvapi-fixture-only'
    assert path.stat().st_mode & 0o777==0o600
    assert 'nvapi-fixture-only' not in json.dumps(provider.status())
