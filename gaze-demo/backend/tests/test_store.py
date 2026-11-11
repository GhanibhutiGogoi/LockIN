import pytest
from lockin.store import Store


def test_user_isolation_restart_and_token_hash(tmp_path):
    path = tmp_path / 'bank.db'
    store = Store(path)
    a, token = store.create_user('A')
    b, other = store.create_user('B')
    with store.transaction(a['id']) as tx:
        tx.put('memory', 'same', {'id': 'same', 'text': 'only A'})
    with store.transaction(b['id']) as tx:
        assert tx.get('memory', 'same') is None
        assert tx.list('memory') == []
    assert Store(path).authenticate(token) == a['id']
    assert store.authenticate(other) == b['id']
    assert store.authenticate('bogus') is None
    assert token.encode() not in path.read_bytes()
    with pytest.raises(RuntimeError):
        with store.transaction(a['id']) as tx:
            tx.put('memory', 'rollback', {'text': 'wrong'})
            raise RuntimeError('rollback')
    with store.transaction(a['id']) as tx:
        assert tx.get('memory', 'rollback') is None
        assert len(tx.list('memory')) == 1
