# Contributing

Thanks for wanting to improve Open Screenshot Generator. Issues and pull requests are welcome. For anything bigger than a bug fix, open an issue first so we can talk it through before you spend time on it.

## Dev setup

You need Node 18.18 or newer.

```bash
git clone https://github.com/dotnetdreamer/open-screenshot-generator.git
cd open-screenshot-generator
npm install
npm run dev
```

The dev server runs at http://localhost:9002. The desktop (Tauri) shell has its own setup, see [docs/DESKTOP.md](docs/DESKTOP.md).

## Before you open a PR

- Run `npm run typecheck`. The production build is configured to ignore TypeScript errors, so a passing build proves nothing about types.
- Run `npm run lint`.
- There is no test suite yet, so click through the flows your change touches in the running app.

## Where things live

The README's "How the code is organized" section is the map. The short version: the editor lives in [src/components/artboard-studio/](src/components/artboard-studio/), and the whole data model is in [src/types/artboard.ts](src/types/artboard.ts). Read that file first.

## Adding a template

Templates are plain JSON in [public/data/projects/](public/data/projects/). Drop your file there, add its filename to the array in [src/services/projectService.ts](src/services/projectService.ts), then run `npm run gen:ai-catalog` so the AI agent's catalog stays in sync. The practical way to author one is to design it in the app and mirror the shape of an existing template file.

## House style for visible copy

No em or en dashes in UI strings, README prose, or website copy. Use a comma, a period, a colon, or the word "to" instead.

## Questions

Use [GitHub Discussions](https://github.com/dotnetdreamer/open-screenshot-generator/discussions) for questions and ideas, and reserve issues for bugs and concrete feature work.
