# ABEA

A beautiful, open messenger built on [Matrix](https://spec.matrix.org/latest/). It runs in the browser, on the desktop (macOS and Windows) and on mobile (Android and iOS).

| Variant | Folder | Tech |
| --- | --- | --- |
| Browser app | [`web/`](web) | Vite + React, installable as a PWA |
| Desktop app (macOS, Windows, Linux) | [`desktop/`](desktop) | Electron + electron-builder |
| Mobile app (Android, iOS) | [`mobile/`](mobile) | Capacitor 8 |
| Shared UI and Matrix logic | [`shared/`](shared) | React 19, TypeScript, matrix-js-sdk |

All three apps render the same React UI from `shared/`. Each one injects a small `PlatformAdapter` (see `shared/src/platform.tsx`) for native integration: notifications, unread badge, system theme, the back button, safe areas and opening links.

## Features

- **Chats:** 1:1 direct messages, end-to-end encrypted by default (Rust crypto). Includes text, emoji, images and files, replies, edits (press <kbd>↑</kbd> to edit your last message), reactions, deletion, typing indicators, read receipts and an image lightbox.
- **Group chats:** create groups with a name, topic, picture and members. You can invite and remove members, see admin and moderator roles, rename the group, change its picture or topic, and leave.
- **Contacts:** an A–Z address book synced across devices through account data (`app.abea.contacts`). You can search the server's user directory, view contact profiles, and start a chat from a contact.
- **Profile images:** avatars for users, contacts and chats, with uploading, cropping to a square and a generated fallback.
- **Invites:** accept or decline invitations to chats and groups.
- **Accounts:** sign in, register, sign out, and SSO (web and desktop). Uses `.well-known` homeserver discovery.
- **Theming:** light, dark and "follow system" themes, a responsive layout from phone to widescreen, and safe-area support.

## Getting started

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
```

### Browser

```bash
npm run dev:web        # http://localhost:5173
npm run build:web      # static site in web/dist (deploy to any static host)
```

### Desktop (Electron)

```bash
npm run dev:desktop                      # Vite renderer with hot reload, inside Electron
npm run build:desktop                    # build the renderer
npm run dist:mac  -w @abea/desktop       # universal .dmg (run on macOS)
npm run dist:win  -w @abea/desktop       # NSIS installer for x64 + arm64 (run on Windows)
```

Packaged apps load the UI from a sandboxed `app://abea` scheme with context isolation. They use a hidden-inset title bar on macOS and the native frame on Windows. They also provide native notifications, a dock or taskbar unread badge, and persisted window state.

### Mobile (Capacitor)

The `android/` and `ios/` native projects are checked in. You need Android Studio for Android, and Xcode on macOS for iOS.

```bash
npm run android -w @abea/mobile   # build web assets, cap sync, open Android Studio
npm run ios     -w @abea/mobile   # build web assets, cap sync, open Xcode
npm run run:android -w @abea/mobile   # build and run on a connected device or emulator
```

The mobile app supports edge-to-edge safe areas, status-bar styling that follows the theme, the Android hardware back button, local notifications for new messages, and keyboard-aware layouts.

#### Android APK from GitHub Actions

The [`Android APK`](.github/workflows/android.yml) workflow builds an installable APK. It runs on every change to `mobile/` or `shared/`, on `v*` tags, and on demand from the **Actions → Android APK → Run workflow** button.

1. Open the workflow run and download the **ABEA-android-…** artifact (a zip containing the APK).
2. Copy `ABEA-<version>-debug.apk` to your phone, open it, and allow "Install unknown apps" when Android asks.

Pushing a tag such as `v0.1.0` also attaches the APKs to a GitHub release.

To get a signed release APK too (needed for updates without uninstalling), add these repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Create a keystore once with `keytool -genkeypair -v -keystore release.jks -alias abea -keyalg RSA -keysize 4096 -validity 10000`.

> Mobile WebViews only allow **https** homeservers. On a device, `http://localhost` points at the phone itself.

### Icons

All icons, splash screens and installers are rendered from `assets/icon.svg`:

```bash
npm i --no-save sharp png-to-ico && node assets/generate-icons.mjs
```

## Local test homeserver

```bash
docker run -d --name abea-synapse -p 8008:8008 -v /tmp/synapse-data:/data \
  -e SYNAPSE_SERVER_NAME=localhost -e SYNAPSE_REPORT_STATS=no matrixdotorg/synapse generate
# set `enable_registration: true` and `enable_registration_without_verification: true`
# in /tmp/synapse-data/homeserver.yaml, then:
docker start abea-synapse
```

Then sign in to `http://localhost:8008` from the web or desktop app.

## Project layout

```
shared/src/
  matrix/      session, client lifecycle, rooms, contacts, media and React hooks
  screens/     login, chat list, room view, room info, contacts, settings, …
  components/  avatar, avatar picker, user picker, emoji picker, lightbox, …
  styles/      design tokens (light and dark) and component styles
web/ desktop/ mobile/   thin platform shells around <App platform={…} />
```
