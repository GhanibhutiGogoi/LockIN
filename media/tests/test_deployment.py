from lockin_media.deployment import setup_runtime


def test_install_plans_are_isolated_pinned_and_do_not_install(tmp_path):
    for kind in ("voice", "video", "aligner"):
        commands = setup_runtime(kind, tmp_path, execute=False)
        assert "--frozen" in commands[-1]
        if kind != "aligner":
            assert "--detach" in commands[1]
            assert len(commands[1][-1]) == 40
    assert not list(tmp_path.iterdir())


def test_ltx_natten_is_requested_from_the_workspace(tmp_path):
    command = setup_runtime("video", tmp_path, execute=False)[-1]
    # The natten extra belongs to ltx-core, not ltx-pipelines.
    assert "--all-packages" in command
    assert "--extra" in command and "natten" in command
