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
- **Device verification:** cross-signing with a recovery key and secure key backup. Verify a new device with emoji (SAS) from another session or with the recovery key, and verify contacts from their profile. Includes a device list with sign-out, warnings for unverified sessions, and alerts when a contact's identity changes.
- **Notifications:** desktop and browser notifications, and on mobile local notifications grouped per chat plus optional remote push (FCM/APNs through a Matrix push gateway) while the app is closed. Tapping a notification opens the chat.
- **Invites:** accept or decline invitations to chats and groups.
- **Accounts:** sign in, register, sign out, and SSO (web and desktop). Uses `.well-known` homeserver discovery.
- **Theming:** light, dark and "follow system" themes, a responsive layout from phone to widescreen, and safe-area support.

## Getting started

Find the installed app's version under **Settings → About ABEA → App version** on mobile, desktop and web. The full version includes the `-internal.N` suffix for internal builds.

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

The mobile app supports edge-to-edge safe areas, status-bar styling that follows the theme, the Android hardware back button, notifications for new messages, and keyboard-aware layouts.

#### Notifications and push

While the app runs, new messages arrive via `/sync` and notify when you are not viewing that chat. Turn notifications on or off under **Settings → Notifications**. Notifications disappear after the messages are marked read, including when you read them on another device. Merely opening a chat while scrolled into older history does not dismiss unread messages.

On **Android**, local messages and remote pushes both use conversation-style notifications (`MessagingStyle` with a per-chat conversation shortcut), showing sender names and recent messages. Expand a notification for **Mark as read** and **Reply**; Reply opens Android's inline keyboard. Read markers are sent to Matrix, and replies go through the normal Matrix SDK so encrypted chats remain encrypted. New messages arriving during a read action remain visible.

If Android has killed the app's encrypted client, notification actions are saved on the device and explicitly show **Open ABEA to send your reply** / **Open ABEA to mark as read**. Opening ABEA resumes them; a failed action remains queued with an error status instead of reporting success. These queues are excluded from Android backup and cleared on account changes/sign-out. With the client still running in the background, actions are processed without opening the chat.

To get notifications while the app is **closed**, ABEA registers a Matrix [HTTP pusher](https://spec.matrix.org/latest/client-server-api/#push-notifications) with your homeserver. This needs a push gateway such as [Sygnal](https://github.com/matrix-org/sygnal), configured with these app IDs:

| Platform | Pusher `app_id` | Sygnal app type |
| --- | --- | --- |
| Android | `app.abea.messenger.android` | `gcm` (FCM, `api_version: v1`) |
| iOS | `app.abea.messenger.ios` | `apns` (`event_id_only`: message content never leaves the homeserver) |

Build with the gateway URL, for example `VITE_PUSH_GATEWAY=https://push.example.com/_matrix/push/v1/notify npm run sync -w @abea/mobile`. You can override the app IDs with `VITE_PUSH_APP_ID_ANDROID` and `VITE_PUSH_APP_ID_IOS`.

- **Android:** put your Firebase `google-services.json` in `mobile/android/app/`. Push stays off without `VITE_PUSH_GATEWAY`, so the app never touches Firebase when it isn't configured.
- **iOS:** enable the *Push Notifications* capability for the app ID in your Apple developer account. `App.entitlements` already declares `aps-environment`.

#### Android APK from GitHub Actions

The [`Android APK`](.github/workflows/android.yml) workflow builds an installable APK. It runs automatically when a pull request is opened or updated, on every push to `main`, and on demand from **Actions → Android APK → Run workflow**.

1. Open the **Releases** page (or the workflow run's **ABEA-android-…** artifact).
2. Copy `ABEA-<version>-debug.apk` to your phone, open it, and allow "Install unknown apps" when Android asks.

**Versioning.** [`glueckkanja/action-semantic-version`](https://github.com/glueckkanja/action-semantic-version) derives each build's version from the [Conventional Commits](https://www.conventionalcommits.org/) since the last stable tag: `feat!:` gives a major bump, `feat:` a minor bump, anything else a patch.

| Built from | Version | Published as |
| --- | --- | --- |
| `main` | `X.Y.Z` | GitHub release and tag `vX.Y.Z` |
| pull requests and other branches | `X.Y.Z-internal.N` | GitHub pre-release and tag `vX.Y.Z-internal.N` |

The version is stamped into the APK's `versionName` (the `versionCode` is the run number), shown under **Settings**, and written to the iOS project by `npm run version:set -w @abea/mobile -- <version> <build>` (iOS gets the numeric `X.Y.Z` as `MARKETING_VERSION`). Pull requests from forks are built but not released.

To get a signed release APK too (needed for updates without uninstalling), add these repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64 encoded |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Create the keystore **once**, on a machine you trust, and keep an encrypted backup of it together with its
password: losing it means no future build can ever update an already installed ABEA, and leaking it lets
anyone publish an update that Android accepts as genuine. Use `-storetype PKCS12` (the industry standard);
Gradle detects the format from the file, so the `.jks` extension and the workflow stay unchanged. A keystore
you already created as JKS also works — `keytool` only prints a migration warning — but PKCS12 avoids it.
In PKCS12 the key password must equal the store password, so press Enter at the key password prompt.

**Linux/macOS**

```bash
keytool -genkeypair -v -keystore release.jks -storetype PKCS12 -alias abea \
  -keyalg RSA -keysize 4096 -validity 10000
chmod 600 release.jks

base64 -w0 release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --repo MichaMican/ABEA
gh secret set ANDROID_KEYSTORE_PASSWORD --repo MichaMican/ABEA   # prompts, nothing lands in shell history
gh secret set ANDROID_KEY_PASSWORD --repo MichaMican/ABEA
gh secret set ANDROID_KEY_ALIAS --repo MichaMican/ABEA --body abea
```

**Windows (PowerShell)**

`keytool` ships with every JDK; Android Studio bundles one at
`C:\Program Files\Android\Android Studio\jbr\bin`.

```powershell
# 1. Make keytool available (skip if `keytool -help` already works)
$env:Path += ';C:\Program Files\Android\Android Studio\jbr\bin'

# 2. Generate the keystore. Type a long random password (24+ chars, from a password
#    manager) when prompted, and press Enter at the key password prompt to reuse it.
New-Item -ItemType Directory -Force "$env:USERPROFILE\abea-signing" | Out-Null
Set-Location "$env:USERPROFILE\abea-signing"
keytool -genkeypair -v -keystore release.jks -storetype PKCS12 -alias abea `
  -keyalg RSA -keysize 4096 -validity 10000

# 3. Lock the file down to your account only (the chmod 600 equivalent)
icacls release.jks /inheritance:r /grant:r "$env:USERDOMAIN\$($env:USERNAME):(R,W)"

# 4. Upload the secrets (gh trims the trailing newline, so the pipe is safe)
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\release.jks"))
$b64 | gh secret set ANDROID_KEYSTORE_BASE64 --repo MichaMican/ABEA
gh secret set ANDROID_KEYSTORE_PASSWORD --repo MichaMican/ABEA   # prompts, nothing lands in PSReadLine history
gh secret set ANDROID_KEY_PASSWORD --repo MichaMican/ABEA
gh secret set ANDROID_KEY_ALIAS --repo MichaMican/ABEA --body abea

# 5. Clear the base64 blob out of the session
Remove-Variable b64
```

Do not pass passwords via `-storepass`/`-keypass` or `--body`: PowerShell records command lines in
`$env:APPDATA\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`. After the secrets exist,
install the APK **without** `-debug` in its name; the switch from the throwaway debug key to the release key
needs one final uninstall/reinstall, after which in-place updates work.

To enable remote push in CI builds, add the secret `GOOGLE_SERVICES_JSON` (the file's contents) and the secret or variable `PUSH_GATEWAY_URL`.

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
