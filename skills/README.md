# Agent skills for Open Screenshot Generator

Five skills that teach a coding agent to produce App Store and Google Play assets from inside an
app's own repository, using the `open-screenshot-generator` CLI (`osg`). The CLI drives the real
editor headlessly, so what an agent renders is what the app renders.

Every skill is a single `SKILL.md` with YAML frontmatter carrying `name` and `description`, so the
same file loads unchanged in Claude Code, installs through the skills CLI, and stays inside the
agentskills.io spec.

## Install

**The skills CLI**, which copies the skills into the current project:

```bash
npx skills add dotnetdreamer/open-screenshot-generator
```

**The Claude Code plugin**, which installs them for every project:

```
/plugin marketplace add dotnetdreamer/open-screenshot-generator
/plugin install open-screenshot-generator
```

**npm**, which is all you need if your agent reads skills from `node_modules`, and is what the other
two routes ultimately call:

```bash
npm i -g open-screenshot-generator
osg doctor
```

Nothing has to be installed for the commands themselves. Every command in every skill is written as
`npx -y open-screenshot-generator@0 <cmd>`, which fetches on first use and needs only Node 20.12+ and
a Chrome, Edge, Brave or Chromium on the machine.

## The five skills

| Skill | Use it when | Starts with |
| --- | --- | --- |
| **store-screenshots** | "make screenshots for the store", "I need App Store assets" | `osg doctor`, `osg init` |
| **app-preview-video** | "make a video for the App Store", "turn this recording into a preview" | `osg doctor`, `osg video` |
| **store-localization** | "we are launching in Japan", "translate the screenshots" | `osg localize` |
| **editor-tools** | "move that headline", "connect the design tools to my agent" | `osg mcp`, `osg install` |
| **store-compliance** | "is this ready to submit", "upload to App Store Connect" | `osg verify`, `osg upload` |

**store-screenshots** is the entry point and the one to read first. It carries the follow up dispatch
table that maps "the user asks for X" onto one file, one field and the cheapest command that
reflects it, which is what makes "make it darker" cost one render instead of a rebuild. The other
four are progressive disclosure: each one goes deep on a subject the flagship only points at, and
they cross reference each other by name.

## Packaging note

Every skill lives at `skills/<name>/SKILL.md` and `name` matches its directory. There is deliberately
no `SKILL.md` at the repository root: the skills CLI treats a root skill's path as the repository
root, and this repository carries well over 170 MB of tracked artwork that would then be copied into
every install.
