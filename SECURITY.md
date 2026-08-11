# AstraFetch Security Notes

## Browser isolation

AstraFetch uses one persistent Chromium partition named `persist:astrafetch-browser`. Remote sites run in a dedicated `WebContentsView` with:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`
- no preload script exposed to remote pages
- DevTools disabled in production

The main application renderer uses a separate session and cannot navigate to remote pages.

## Permissions

The browser session denies camera, microphone, geolocation, display capture, HID, USB, serial, filesystem, and notification permissions. Sanitized clipboard writing and fullscreen are the only allowed permission categories.

## Cookie handling

- Public downloads use no cookies by default.
- Browser cookies are exported only after the user selects **Built-in browser**.
- A random temporary Netscape-format file is created under the Windows temporary directory.
- The file has restrictive local permissions where supported.
- The path and cookie values are excluded from renderer snapshots and logs.
- The file is deleted when analysis or download finishes.
- Temporary files older than one hour are removed during application startup.

The built-in browser should not be used for banking, cryptocurrency wallets, primary email, or high-value administration accounts. One shared browser profile means one compromised profile can expose sessions for every website used inside it.

## External binaries

Bootstrap scripts fetch `yt-dlp`, FFmpeg, Electron, and Node.js from their official release sources and verify published SHA-256 values before installation. The production executable applies Electron fuses that disable RunAsNode, NODE_OPTIONS, and the CLI inspector while enabling cookie encryption and ASAR integrity checks.

## Limitations

AstraFetch does not bypass DRM, paywalls, account permissions, geographic restrictions, or platform access controls. Only download media that you are permitted to access and save.
