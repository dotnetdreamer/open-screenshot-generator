# Contributing

Bug reports, fixes, and new templates are welcome. For a larger feature, open an issue first so you can discuss the approach before writing code.

## Dev setup

You need Node 18.18 or newer.

```bash
git clone https://github.com/dotnetdreamer/open-screenshot-generator.git
cd open-screenshot-generator
npm install
npm run dev
```

Open <http://localhost:9002>. For desktop development, see the [desktop guide](docs/DESKTOP.md).

## Before you open a PR

Run `npm run typecheck` and the end to end tests that cover your change. The test commands and setup are in [tests/e2e/README.md](tests/e2e/README.md).

The production build ignores type errors. The `npm run lint` script currently opens a setup prompt because this repo has no ESLint configuration, so do not use it as a check.

## Where things live

The editor is in [src/components/open-screenshot-generator/](src/components/open-screenshot-generator/). Its project and artboard types are in [src/types/artboard.ts](src/types/artboard.ts). Developer notes and architectural rules are in [.agents/AGENTS.md](.agents/AGENTS.md).

## Adding a template

1. Make the design in the editor and use an existing template as a guide for its JSON format.
2. Put the JSON file in [public/data/projects/](public/data/projects/).
3. Add its filename to the right category in [src/lib/templateCategories.ts](src/lib/templateCategories.ts).
4. Run `npm run gen:ai-catalog` so the AI agent can find it.

## House style for visible copy

Use plain language in text people see in the app or on the website. Do not use em or en dashes in that copy; use a comma, period, colon, or "to" instead.

## Questions

Use [GitHub Discussions](https://github.com/dotnetdreamer/open-screenshot-generator/discussions) for questions and ideas. Use issues for bugs and specific feature requests.
