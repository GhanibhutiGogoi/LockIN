# Starter gameplay and music

API setup (`media/scripts/setup.sh api` or `all`) and Docker Compose download the media to the service host. Learners stream the selected assets from the service. Git contains a [download manifest](../src/lockin_media/starter-library.json) with URLs, authors, reuse terms, sizes, durations and SHA-256 hashes.

| Library | Files | Download and installed size | Limit |
| --- | ---: | ---: | ---: |
| Gameplay | 6 MP4s | 281,192,672 bytes | 1,000,000,000 bytes |
| Music | 7 MP3s | 40,304,682 bytes | 200,000,000 bytes |

### Gameplay

- Three portrait Minecraft parkour segments from two recordings. [Orbital – No Copyright Gameplay](https://youtu.be/BXUA2FncVPI) · [GameplaysForFree](https://youtu.be/XBIaqOm0RKQ)
- One portrait GTA V stunt-driving segment. [Orbital – No Copyright Gameplay](https://youtu.be/weAUrmRLpnk)
- One landscape Roblox *Tower of Hell* obstacle-course recording by RODBlox. [Source and uploader CC0 designation](https://archive.org/details/roblox-tower-of-hell-pero-es-un-noob)
- One vertical Subway Surfers run. The archive lists the recording under CC0 and credits “Subway Surfers.” [Source and uploader license](https://archive.org/details/subway-surfers-2024-gameplay-4-k-9x-16-no-copyright-1)

The Minecraft and GTA files are portrait edits distributed by DocuForge under CC BY 3.0. The manifest credits the uploaders named in its per-clip records and links to the original videos. The licenses here describe the supplied recordings. [Pinned distribution](https://github.com/Prixeree/docuforge-assets/tree/af1ecb7a85c0b5d4dfd1af3ebe80bd75cca800b1) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

### Music

Kevin MacLeod supplies the seven instrumentals under CC BY 4.0. The manifest includes his individual track pages and published BPM. Preserve the title, creator, source and license with any exported or shared edit, and identify edits such as cropping or mixing. [Incompetech catalog](https://incompetech.com/music/royalty-free/full_list.html) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

| Track | Mood | BPM |
| --- | --- | ---: |
| Monkeys Spinning Monkeys | Playful | 144 |
| Sneaky Snitch | Sneaky | 87 |
| Fluffing a Duck | Comic | 122 |
| Carefree | Upbeat | 96 |
| Local Forecast - Elevator | Laid-back | 82 |
| Cipher | Electronic | 150 |
| Investigations | Curious | 94 |

### Use and repair

`GET /library/gameplay` and `GET /library/music` return playable, service-relative URLs and credit fields. The existing narration mixer accepts one selected track through `LOCKIN_MUSIC_FILE`. Automatic soundtrack selection is a separate recap feature.

Run `media/scripts/download-library.sh` again to repair an installation. Verified files are reused, including completed transfers from an interrupted install. The downloader checks the byte budgets before connecting and the expected size and hash before publishing each file. The API switches to the new index after all files verify. Media goes under `LOCKIN_DATA_DIR/assets`. Locally published library entries count toward the caps. On a network that requires a proxy, the downloader honors the standard `HTTPS_PROXY` and `NO_PROXY` environment variables.
