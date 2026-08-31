# Where this skill came from

Vendored from <https://github.com/blader/humanizer> (MIT, by blader).

- Version: `2.11.2`
- Commit: `e2e92e7b4b8229253ed5c8e81dc65463fdeddda5`
- Pulled: 31 Aug 2026

`SKILL.md` is upstream's file. `LICENSE` is upstream's MIT licence and must stay.

## The one local change

The `description` in the frontmatter has four extra lines naming the two places
this repo requires the skill: code comments, and any string a player reads. The
upstream description only talks about prose in general, so without those lines
the skill never surfaces when the job is "write a comment" or "word this toast",
which is most of what we use it for.

Nothing below the frontmatter is modified. Keep it that way, so an update is a
straight file copy.

## Updating it

```sh
git clone --depth 1 https://github.com/blader/humanizer.git /tmp/humanizer
cp /tmp/humanizer/SKILL.md .claude/skills/humanizer/SKILL.md
cp /tmp/humanizer/LICENSE  .claude/skills/humanizer/LICENSE
```

Then re-apply the description lines above, bump the version and commit here, and
re-read `.agents/AGENTS.md` § "Writing comments and player-facing copy" to check
the pattern numbers it cites still point at the same patterns. That section names
§7, §14, §15, §16, §18, §19, §23 and §25. Upstream renumbers patterns when it
adds or removes one, and a stale number is worse than none: it sends the reader
to a rule about something else.
