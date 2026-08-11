# AstraFetch

AstraFetch is a privacy-first Windows media downloader built with Electron, `yt-dlp`, and FFmpeg. Public media is downloaded without cookies by default. For sites that require authentication, AstraFetch includes one shared persistent Chromium session and can pass relevant browser cookies to `yt-dlp` only for the current operation.

## Features

- Public downloads without cookies by default
- Built-in Chromium browser with one persistent session
- Optional browser-session authentication for supported sites
- Manual `cookies.txt` fallback
- Download queue with retry, cancel, resume via `.part`, and history
- Presets for best quality, 4K, 1440p, 1080p, 720p, MP3, and original audio
- Optional subtitles, automatic subtitles, metadata, chapters, and thumbnails
- Unicode-safe filenames, including Cyrillic and other non-ASCII scripts
- Local `yt-dlp` and FFmpeg bootstrap with integrity verification
- Portable Windows build and NSIS installer
- Sandboxed remote browser content with no Node.js integration

## Quick start

Extract the project into a short path, for example:

```text
A:\Apps\AstraFetch
```

Run:

```text
REPAIR_AND_RUN.bat
```

Do not run AstraFetch as Administrator.

## Updating from GitHub

Keep `UPDATE_FROM_GITHUB.bat` in the project root and run it whenever a new version is pushed to `main`. It connects the folder to `https://github.com/ardesart/AstraFetch`, fetches `main`, and resets tracked source files to the current repository state. Generated runtime folders and user data remain outside version control.

## Normal workflow

1. Paste a media URL.
2. Keep **No cookies** selected for public media.
3. Click **Analyze**.
4. Choose a preset and output folder.
5. Add the job to the queue.

For media that requires a logged-in session:

1. Open **AstraFetch Browser**.
2. Sign in directly on the required website.
3. Return to the downloader and choose **Built-in browser**.
4. Analyze or download the URL.

AstraFetch exports matching browser cookies to a random temporary Netscape-format file only for the lifetime of the `yt-dlp` operation. The file is deleted afterward, and stale temporary cookie files are cleaned on startup.

## Authentication modes

- **No cookies** — default and recommended for public media.
- **Built-in browser** — uses the single persistent AstraFetch Chromium session.
- **cookies.txt** — manual fallback for services that reject embedded-browser login.

Google and some other identity providers may reject sign-in inside embedded Chromium. That is a platform policy limitation rather than a downloader failure.

## Unicode filenames

AstraFetch launches `yt-dlp` with its external configuration disabled and explicitly keeps unrestricted Unicode filenames enabled. This prevents machine-wide `yt-dlp` settings such as `--restrict-filenames` from stripping Cyrillic or other Unicode characters. `--windows-filenames` is still used so Windows-invalid filename characters are sanitized safely.

## Dependency bootstrap

AstraFetch uses exact top-level dependency versions from `package.json`. The Windows bootstrap deliberately does not depend on a committed `package-lock.json`; stale local lock files are removed before installation to avoid broken transitive pins. Electron's Windows runtime is downloaded separately from the official Electron release, verified against `SHASUMS256.txt`, and then validated locally.

## Included scripts

- `RUN.bat` — prepares missing local dependencies and starts AstraFetch.
- `REPAIR_AND_RUN.bat` — repairs the local runtime and starts AstraFetch.
- `FIX_DEPENDENCIES_AND_RUN.bat` — performs a clean dependency repair, then starts AstraFetch.
- `UPDATE_FROM_GITHUB.bat` — updates tracked project files from GitHub `main`.
- `BUILD_INSTALLER.bat` — builds x64 portable and NSIS packages into `dist`.
- `CLEAN.bat` — removes generated dependencies, caches, binaries, and build output while preserving the local Node.js runtime.

All bootstrap BAT and PowerShell output is English-only.

## Build

Run:

```text
BUILD_INSTALLER.bat
```

Expected outputs:

```text
dist\AstraFetch-1.0.2-portable-x64.exe
dist\AstraFetch-1.0.2-nsis-x64.exe
```

## Security

- Remote pages run in a dedicated `WebContentsView`.
- `nodeIntegration` is disabled for remote content.
- `contextIsolation`, Chromium sandboxing, and `webSecurity` are enabled.
- Camera, microphone, geolocation, device, filesystem, display-capture, and notification permissions are denied.
- Browser-initiated downloads are blocked.
- Cookie values are never written to application logs.
- Temporary authentication files are deleted after use.
- AstraFetch does not bypass DRM or platform access controls.

See [`SECURITY.md`](SECURITY.md) for the full security model.

## Development

```text
npm install --package-lock=false
npm test
npm run check
npm start
```

The Windows bootstrap scripts use a project-local Node.js runtime, so a global Node.js installation is not required for end users.

## License

MIT. See [`LICENSE`](LICENSE).
