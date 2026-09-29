# Agent skills for Open Screenshot Generator

These five skills help a coding agent make App Store and Google Play assets with Open Screenshot Generator. Each one covers a different job. Start with `store-screenshots` if you are making a new screenshot set.

## Install

To add the skills to a project:

```bash
npx skills add dotnetdreamer/open-screenshot-generator
```

In Claude Code, you can install the plugin, which includes the skills and the design tools:

```text
/plugin marketplace add dotnetdreamer/open-screenshot-generator
/plugin install open-screenshot-generator@open-screenshot-generator
```

The CLI commands can also run without installing the skills. They need Node 20.12 or newer and Chrome, Edge, or Chromium. Check your setup with `npx open-screenshot-generator doctor`.

## The five skills

| Skill | Use it for |
| --- | --- |
| `store-screenshots` | Make a set of store screenshots from your app's screenshots |
| `app-preview-video` | Turn a screen recording into an App Store preview video |
| `store-localization` | Make versions of your store images in other languages |
| `editor-tools` | Let an agent edit a design with the CLI or MCP tools |
| `store-compliance` | Check files against store rules or upload them |

The skill files are in the folders under `skills/`. For all CLI commands and options, see the [CLI guide](../cli/README.md).

## Packaging note

Each skill has its own folder and `SKILL.md` file. The repository root has no `SKILL.md`, so installing a skill does not copy the repository's artwork into your project.
