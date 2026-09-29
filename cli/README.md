# open-screenshot-generator

[![npm version](https://img.shields.io/npm/v/open-screenshot-generator)](https://www.npmjs.com/package/open-screenshot-generator)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/cli/LICENSE)

Use Open Screenshot Generator from a terminal or a coding agent. It can turn screenshots of your app into store images without opening the editor by hand.

## What this is

The package runs the same editor as the web and desktop apps in a browser it controls. It can make screenshots, preview videos, and translated sets. A project made with the CLI can be opened in the visual editor.

## Before you start

You need Node 20.12 or newer and Chrome, Edge, or Chromium. MP4 export needs Chrome or Edge; PNG export also works with Chromium. Keep screenshots of your app in a folder, in the order you want them used.

You do not need an account or an API key to use templates. The optional AI `design` command needs a key.

## Install

Run a command without installing the package first:

```bash
npx open-screenshot-generator doctor
```

If you use it often, install it globally and type `osg`:

```bash
npm install -g open-screenshot-generator
osg doctor
```

`doctor` checks your setup. If you need a browser, `doctor --install-browser` can download one.

## Quick start

```bash
npx open-screenshot-generator init
npx open-screenshot-generator fill --screenshots ./shots
npx open-screenshot-generator render
npx open-screenshot-generator verify
```

`init` creates a configuration file. `fill` chooses a template and places the images from `./shots`. `render` saves the finished files, and `verify` checks their sizes and other store requirements. Use `studio` to open the project in the visual editor.

You can also fetch an existing App Store listing with `import`, or describe a design to the AI agent:

```bash
npx open-screenshot-generator design ./shots "dark theme for a running tracker"
```

The `all` command runs the full workflow after you have set up a project.

## Commands

| Command | What it does |
| --- | --- |
| `init` | Create a project configuration file |
| `doctor` | Check Node, the browser, video support, and downloaded assets |
| `templates` | Find a template |
| `new` | Start a project from a chosen template |
| `import` | Fetch an existing App Store listing |
| `fill` | Choose a template and place screenshots without AI |
| `design` | Make a project from screenshots and an AI prompt |
| `edit` | Run design tools on a project |
| `call` | Run one design tool and print its result |
| `render` | Export store screenshots |
| `video` | Export an App Store preview video |
| `localize` | Add languages and translate text |
| `verify` | Check exported files against store rules |
| `manifest` | Write a list of exported files |
| `studio` | Open the project in the visual editor |
| `upload` | Upload files to App Store Connect or Google Play |
| `mcp` | Start a server for a coding agent |
| `install` | Add that server to a supported coding agent |
| `cache` | Manage downloaded artwork and fonts |
| `editor` | Choose the editor bundle the CLI runs |
| `all` | Run the full build and export workflow |

Run `npx open-screenshot-generator <command> --help` for options.

## Use it from your coding agent

### MCP server

Run this to add the design tools to a supported coding agent on your machine:

```bash
npx open-screenshot-generator install
```

You can also run `npx open-screenshot-generator mcp --stdio` and add it to an agent's MCP configuration yourself. The [CLI reference](../docs/CLI.md#the-mcp-server) explains the options.

### Skills

The [agent skills](../skills/README.md) give a coding agent instructions for making screenshots, videos, and translated sets. Install them with:

```bash
npx skills add dotnetdreamer/open-screenshot-generator
```

## The config file

`init` writes `osg/osg.config.ts`. It records choices such as the app name, screenshots folder, store sizes, and languages. You can edit it and run `render` again without starting over. The [config reference](../docs/CLI.md#the-config-file) explains each field. Keep API keys in environment variables, outside the config file.

## What it does on your machine

The CLI starts a local server and runs the editor in a browser with a temporary profile. It writes your project and exports to the paths you choose. It downloads template artwork and fonts when needed, then caches them. It sends no usage analytics. The `design` command contacts the AI provider you choose.

Use `--offline` to stop requests beyond the local server. The command stops if an asset it needs is not already cached.

## Full documentation

The [CLI reference](../docs/CLI.md) covers every command, flag, configuration field, exit code, cache location, and troubleshooting step. The [main README](../README.md) covers the visual editor.

## License

The code is [MIT licensed](LICENSE). Template artwork has separate licenses and is not bundled with this npm package. See [THIRD-PARTY-ASSETS.md](../THIRD-PARTY-ASSETS.md) before redistributing assets.
