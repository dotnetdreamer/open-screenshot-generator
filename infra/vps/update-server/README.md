# The update server

Where the desktop app gets its updates. The Tauri updater asks it whether there
is a newer version for its platform and channel, then downloads the signed
installer from it. CI uploads each release through an admin API and moves a
channel pointer to it.

It has no dependencies and no database: Node's standard library, and a release
is a folder of files. It reads that folder once at startup and keeps it in
memory. Deploying it, its DNS record and the checks that it works are in the
parent [README](../README.md#desktop-updates).

## The check

```
GET /v1/desktop/{target}/{arch}/{bundle}/{current}?channel=stable&bucket=42
```

| Part | Values |
| --- | --- |
| `target` | `windows`, `darwin`, `linux` |
| `arch` | `x86_64`, `aarch64`, `i686`, `armv7` |
| `bundle` | `nsis`, `msi`, `app`, `appimage`, `deb`, `rpm`, or `unknown` |
| `current` | the installed version. A leading `v` is dropped, and it may arrive percent-encoded |
| `channel` | `stable`, the default, or `beta` |
| `bucket` | a number from 0 to 99 that places the install in a rollout. Without one it is 99, so the install gets a release only once it is out to everybody |

`204` means there is nothing newer. `200` carries what Tauri reads, `version`,
`pub_date`, `notes`, `url` and `signature`, plus `size`, `sha256`, `critical`,
`channel` (the pointer the release came from) and `download_page`. `notes` is
left out when it is empty. A parameter it cannot use is a `400` with
`{"error": "..."}`. Every answer carries `Cache-Control: no-store`.

How it decides:

1. A stable install follows the stable pointer. A beta install follows whichever
   of the beta and stable pointers is newer, so it never sits behind stable.
2. A pointer counts only while it is not paused and the install's bucket is
   below its rollout. At rollout 10, buckets 0 to 9 get it.
3. The version must be newer than `current` by semver precedence, prereleases
   included: `1.0.7-rc.1` is older than `1.0.7`.
4. The release must have an artifact for exactly `{target}-{arch}-{bundle}`, so
   an MSI install is never handed the NSIS installer. Only `unknown`, a
   portable exe or a dev build, falls back: to `nsis` then `msi` on Windows,
   `app` on macOS, and `appimage`, `deb`, then `rpm` on Linux.

## Downloads

`GET` and `HEAD /v1/files/{version}/{file}` serve a file that the version's
published manifest lists, and answer 404 for anything else, including a file in
the release folder that the manifest does not name. A single `Range` gets a
`206`. The `ETag` is the file's sha256, and the file may be cached for a year,
since a published file never changes.

## The admin API

Every admin route needs `Authorization: Bearer <UPDATES_ADMIN_TOKEN>`. With no
token configured they answer 404, as if they did not exist, and a wrong or
missing token is a 401.

| Route | What it does |
| --- | --- |
| `PUT /v1/admin/releases/{version}/files/{file}` | uploads one artifact, with `Content-Length` and `X-Content-SHA256` (64 lowercase hex). A body that does not match them is refused. `201` stored, `200` those bytes were already there |
| `PUT /v1/admin/releases/{version}` | publishes the release, after checking every file the manifest names against the disk. `201` published, `200` already published with this manifest |
| `GET /v1/admin/releases` | every release folder, newest first, published or not |
| `GET /v1/admin/channels` | both pointers |
| `PUT /v1/admin/channels/{channel}` | moves a pointer. The body, `{"version", "rollout", "paused"}`, is merged onto the pointer, so each field is optional once it exists. `version` must be published |
| `GET /v1/admin/stats` | the checks since the last start, by channel, platform and installed version, and how often each version was offered |

A manifest names one file for each artifact key, `{target}-{arch}-{bundle}`:

```json
{
  "version": "1.0.7",
  "pubDate": "2026-11-07T12:00:00Z",
  "notes": "What changed, up to 10000 characters",
  "critical": false,
  "downloadPage": null,
  "artifacts": {
    "windows-x86_64-nsis": {
      "file": "app_1.0.7_x64-setup.exe",
      "signature": "<the .sig file Tauri wrote, unchanged>",
      "size": 31457280,
      "sha256": "<64 lowercase hex>"
    }
  }
}
```

`notes` may be left out, `critical` is false unless set, and `downloadPage` is
an https URL or null. A field the server does not know is refused, so a
misspelt one fails the request instead of being dropped.

**A published release never changes.** Different bytes for one of its files, a
file it does not have yet, or a different manifest is a `409`. The same thing
sent again is a `200`, so a CI job can retry any step. To fix a release, publish
a new version. To roll back, point the channel at the older one: installs
already past it are offered nothing, since an update has to be newer.

A publish is: upload every file, `PUT` the manifest, then
`PUT /v1/admin/channels/stable` (or `beta`) with
`{"version": "1.0.7", "rollout": 10}`, and raise the rollout from there.
`{"paused": true}` stops offering it without moving anything. A `PUT` that
changes nothing writes nothing.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8730` | |
| `DATA_DIR` | `/data` | where everything in the next section lives |
| `PUBLIC_URL` | `http://localhost:$PORT` | the start of every download URL the updater is handed |
| `UPDATES_ADMIN_TOKEN` | unset | the admin API is off unless this is at least 32 characters |
| `MAX_UPLOAD_BYTES` | `1073741824` | the largest artifact an upload may be |

## On disk

```
releases/<version>/<file>          an uploaded artifact
releases/<version>/manifest.json   written last. A release that has one is published
channels/stable.json, beta.json    {"version", "rollout", "paused", "updatedAt"}
channels/history.jsonl             one line per pointer change: {"at", "channel", "from", "to"}
tmp/                               uploads on their way in
```

Artifacts, manifests and pointers are written in `tmp/` first and renamed into
place, so a crash leaves the old file or the new one, never part of either, and
the next start clears what was left in `tmp/`. `history.jsonl` is only ever
appended to. This process is the only writer: it reads the directory once at
startup and from then on changes it only through the admin API, so a file
edited by hand is picked up at the next restart.

Checks are counted in memory, so `/v1/admin/stats` starts from nothing at every
restart.
