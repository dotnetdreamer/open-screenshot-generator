/**
 * osg all: the whole thing, once.
 *
 * This is the headline, and the reason it can be one command is that every
 * stage is already a command: this file picks the order, decides which of
 * new / design / fill the inputs call for, and gets out of the way.
 *
 * It runs them on ONE context, which is what makes it worth having. A
 * CommandContext hands out a lazily started session and keeps it, so the
 * browser boots once, the editor bundle is parsed once, and the fonts are
 * fetched once for a run that opens the project four times. Shelling out to
 * `osg render && osg video && osg manifest` pays that boot three times over.
 *
 * The stages keep their own output on stderr and never emit: a run has one
 * machine readable object and `all` is the one that writes it, which is why
 * every derived context below has json switched off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagBool, flagList, flagString } from '../args.js';
import type { CommandContext } from '../context.js';
import { EXIT, usageError } from '../errors.js';
import { bold, dim, emit, fail, humanMs, info, ok, step } from '../log.js';
import { run as runDesign } from './design.js';
import { run as runDoctor } from './doctor.js';
import { run as runFill } from './fill.js';
import { run as runManifest } from './manifest.js';
import { run as runNew } from './new.js';
import { run as runRender } from './render.js';
import { run as runVerify } from './verify.js';
import { run as runVideo } from './video.js';

type Flags = CommandContext['args']['flags'];

interface Stage {
  name: string;
  /** What --skip has to name to leave this out. 'build' covers new|design|fill. */
  aliases: string[];
  run: (ctx: CommandContext) => Promise<number>;
  flags?: Flags;
}

interface StageResult {
  stage: string;
  code: number;
  ms: number;
  skipped: boolean;
}

const SKIPPABLE = new Set(['doctor', 'build', 'new', 'design', 'fill', 'render', 'video', 'manifest', 'verify']);

/**
 * A stage sees the run's flags plus its own, no positionals, and json off.
 *
 * The session method is copied by reference, so every stage shares the one
 * browser this run starts. Positionals are dropped on purpose: `osg all "make
 * it darker"` means an instruction for design, and `osg new` would read the
 * same word as a template slug.
 */
function derive(ctx: CommandContext, stage: Stage): CommandContext {
  return {
    ...ctx,
    json: false,
    args: {
      ...ctx.args,
      command: stage.name,
      positionals: [],
      flags: { ...ctx.args.flags, json: false, ...(stage.flags ?? {}) },
    },
  };
}

/**
 * Which of the three build commands the inputs are asking for.
 *
 * An instruction means the agent. A named template means new. Screenshots and
 * no template mean fill, which ranks the catalog and picks one without a model.
 * A project that already exists and no new input means build nothing and render
 * what is committed, which is what a re-run in CI is.
 */
function planBuild(ctx: CommandContext, instruction: string): Stage | null {
  const flags = ctx.args.flags;
  if (instruction) {
    return { name: 'design', aliases: ['design', 'build'], run: runDesign, flags: { instruction } };
  }

  if (fs.existsSync(ctx.projectFile)) {
    info(dim(`using the project at ${path.relative(ctx.root, ctx.projectFile) || ctx.projectFile}`));
    return null;
  }

  const template = flagString(flags, 'template') ?? ctx.config.template;
  if (template && template !== 'auto') {
    return { name: 'new', aliases: ['new', 'build'], run: runNew, flags: { template } };
  }

  const screenshots = flagString(flags, 'screenshots') ?? ctx.config.screenshots;
  if (screenshots && fs.existsSync(path.resolve(ctx.root, screenshots))) {
    return { name: 'fill', aliases: ['fill', 'build'], run: runFill };
  }

  throw usageError(
    'osg all has nothing to build from.',
    'Give it one of: `--design "<what the app is>"`, `--template <slug>` (see `osg templates`), ' +
      'a `screenshots` directory in osg.config.ts, or an existing project file.'
  );
}

export async function run(ctx: CommandContext): Promise<number> {
  const started = Date.now();
  const flags = ctx.args.flags;

  const skip = new Set(flagList(flags, 'skip') ?? []);
  for (const name of skip) {
    if (!SKIPPABLE.has(name)) {
      throw usageError(`--skip ${name} is not a stage`, `Stages: ${[...SKIPPABLE].join(', ')}.`);
    }
  }

  const instruction = (flagString(flags, 'design') ?? ctx.args.positionals.join(' ')).trim();

  // A recording is what makes a preview video possible at all, so its presence
  // is the switch. --video forces the stage in, --no-video keeps it out.
  const recording = flagString(flags, 'video');
  const wantsVideo =
    flags.video !== undefined ? flagBool(flags, 'video', true) : !!ctx.config.video?.recording;

  const plan: Stage[] = [{ name: 'doctor', aliases: ['doctor'], run: runDoctor }];
  const build = planBuild(ctx, instruction);
  if (build) plan.push(build);
  plan.push({ name: 'render', aliases: ['render'], run: runRender });
  if (wantsVideo) {
    plan.push({
      name: 'video',
      aliases: ['video'],
      run: runVideo,
      // --video <file> names the recording; --video on its own leaves the
      // config's own recording in place.
      flags: recording && recording !== 'true' ? { recording } : {},
    });
  }
  plan.push({ name: 'manifest', aliases: ['manifest'], run: runManifest });
  plan.push({ name: 'verify', aliases: ['verify'], run: runVerify });

  const results: StageResult[] = [];
  let code: number = EXIT.ok;

  for (const [index, stage] of plan.entries()) {
    if (stage.aliases.some((alias) => skip.has(alias))) {
      info(dim(`${index + 1}/${plan.length} ${stage.name} skipped`));
      results.push({ stage: stage.name, code: EXIT.ok, ms: 0, skipped: true });
      continue;
    }

    info(bold(`${index + 1}/${plan.length} ${stage.name}`));
    const since = Date.now();
    const stageCode = await stage.run(derive(ctx, stage));
    results.push({ stage: stage.name, code: stageCode, ms: Date.now() - since, skipped: false });

    if (stageCode !== EXIT.ok) {
      // Doctor failing means the environment cannot do the run at all, and
      // every later stage would fail the same way with a worse message. The
      // same is true of a render that produced nothing for verify to check.
      code = stageCode;
      fail(`${stage.name} exited ${stageCode}, stopping here`);
      break;
    }
  }

  const elapsed = Date.now() - started;
  const ran = results.filter((result) => !result.skipped).length;

  if (ctx.json) {
    emit({
      command: 'all',
      ok: code === EXIT.ok,
      code,
      project: ctx.projectFile,
      out: ctx.outDir,
      store: flagString(flags, 'store') ?? ctx.config.store ?? 'appstore',
      ms: elapsed,
      stages: results,
    });
  } else if (code === EXIT.ok) {
    ok(`${ran} ${ran === 1 ? 'stage' : 'stages'} in ${humanMs(elapsed)}, files in ${path.relative(ctx.root, ctx.outDir) || ctx.outDir}`);
  } else {
    step(`stopped after ${humanMs(elapsed)}`);
  }

  return code;
}
