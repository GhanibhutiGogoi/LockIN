#!/usr/bin/env python3
"""Export the pinned upstream EyeTheia MPIIFaceGaze checkpoint for local Web use."""

import argparse
import hashlib
import importlib.util
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen

import onnx
from scipy.io import loadmat
import torch
from torch import nn

REVISION = '13c3d444da4f7ef9e26a856bc9f46756ae818d87'
SOURCE = f'https://raw.githubusercontent.com/patherstevenson/EyeTheia/{REVISION}'
FILES = {
    'src/tracker/GazeModel.py': '966fb97a09a58ddb3fe4fb7a76140bb391427877c26fb1eda29be1c1dcaa22ee',
    'src/tracker/ExportLRN.py': 'a212772cefcc1210ed85aeb00c876d8d0c826aafeb4fe4f1141083ddd12ffed7',
    'src/models/itracker_mpiiface.tar': '4a16c382249f4b50f6061f37c36d8f29cb77912fee19cd8ff64b22534b3d7df0',
    'src/mat/mean_face_224_MPIIFace.mat': 'f54f471935545375589f98a267fb762a5511135a1294c2f63acd61b682ef3bff',
    'src/mat/mean_left_224_MPIIFace.mat': 'd4de57e1d547532b13df6016f8445c2ec5e24175adb14bdd667b498db73e3d64',
    'src/mat/mean_right_224_MPIIFace.mat': '6e3d0171a9d34653c14eaeef91a36ae8a2e51c6960cb613ace922a30b43bd285',
    'LICENSE': '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986',
}
OUTPUT = Path(__file__).resolve().parents[1] / 'public' / 'models'


class NormalizeInputs(nn.Module):
    def __init__(self, model, folder):
        super().__init__()
        self.model = model
        for region, key in (('face', 'mean_face'), ('left', 'mean_eye_left'), ('right', 'mean_eye_right')):
            mean = loadmat(folder / f'mean_{region}_224_MPIIFace.mat')[key]
            assert mean.shape == (3, 224, 224)
            self.register_buffer(f'{region}_mean', torch.as_tensor(mean / 255, dtype=torch.float32))

    def forward(self, face, left_eye, right_eye, face_grid):
        return self.model(face - self.face_mean, left_eye - self.left_mean, right_eye - self.right_mean, face_grid)


def load_module(folder, name):
    spec = importlib.util.spec_from_file_location(name, folder / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, help='Use already-downloaded upstream files by basename')
    args = parser.parse_args()
    torch.set_num_threads(1)

    with TemporaryDirectory(prefix='lockin-eyetheia-') as temp:
        folder = Path(temp)
        for url_path, digest in FILES.items():
            name = Path(url_path).name
            if args.source_dir:
                contents = (args.source_dir / name).read_bytes()
            else:
                with urlopen(f'{SOURCE}/{url_path}', timeout=90) as response:
                    contents = response.read()
            if hashlib.sha256(contents).hexdigest() != digest:
                raise ValueError(f'Unexpected SHA-256 for {name}')
            (folder / name).write_bytes(contents)

        gaze_model = load_module(folder, 'GazeModel').GazeModel()
        replace_lrn = load_module(folder, 'ExportLRN').replace_crossmaplrn_for_onnx
        checkpoint = torch.load(folder / 'itracker_mpiiface.tar', map_location='cpu', weights_only=True)
        gaze_model.load_state_dict(checkpoint['state_dict'], strict=True)
        reference = NormalizeInputs(gaze_model, folder).eval()
        model = NormalizeInputs(replace_lrn(gaze_model), folder).eval()

        rng = torch.Generator().manual_seed(42)
        images = tuple(torch.rand(1, 3, 224, 224, generator=rng) for _ in range(3))
        grid = torch.zeros(1, 25, 25)
        grid[:, 6:19, 7:18] = 1
        example = (*images, grid.flatten(1))
        with torch.inference_mode():
            original = reference(*example)
            converted = model(*example)
            torch.testing.assert_close(original, converted, atol=1e-5, rtol=1e-5)

        model_file = folder / 'eyetheia-mpiiface.onnx'
        torch.onnx.export(
            model, example, model_file,
            dynamo=False, external_data=False, opset_version=18,
            input_names=['face', 'left_eye', 'right_eye', 'face_grid'], output_names=['gaze'],
        )
        onnx.checker.check_model(model_file)
        OUTPUT.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(model_file, OUTPUT / model_file.name)
        shutil.copyfile(folder / 'LICENSE', OUTPUT / 'eyetheia-LICENSE.txt')
        print(f'EyeTheia {REVISION} → {OUTPUT / model_file.name} ({model_file.stat().st_size:,} bytes)')
        print(f'Upstream PyTorch vs export wrapper max absolute error: {(original - converted).abs().max().item():.8g}')


if __name__ == '__main__':
    main()
