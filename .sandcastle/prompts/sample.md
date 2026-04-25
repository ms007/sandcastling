# TASK

Create a TypeScript file `greeting.ts` at the project root with this content:

```ts
import chalk from 'chalk'

console.log(chalk.green('Hello from sandcastle!'))
```

Then make exactly **one** commit on the current branch using Conventional
Commits style:

```
feat: add greeting script
```

# RULES

- The sandbox already ran `pnpm install --prefer-offline` for you. Don't
  reinstall.
- Stay on the current branch. Don't switch, don't push, don't open a PR.
- Exactly one commit. No amends.
- Don't add tests, READMEs, or other files. Just `greeting.ts`.

# DONE

Output `<promise>COMPLETE</promise>` once `git log -1 --format=%s` reads
`feat: add greeting script` and `greeting.ts` exists at the repo root.
