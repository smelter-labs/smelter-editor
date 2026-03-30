# Resolving Version Mismatch

## Skill version is higher than the installed package

The project is using an older version of the smelter packages than this skill documents. Suggest updating the smelter packages to match the version this skill targets (`^0.4.0`) using the project's package manager.

If the user does not want to update the packages, suggest installing a matching version of the skill by running:

```bash
npx skills add https://github.com/smelter-labs/skills/tree/vMAJOR.MINOR/smelter-ts-docs
```

Replace `MAJOR.MINOR` with the detected installed package version (e.g., `v0.2` for version `0.2.x`).

## Installed package version is higher than the skill

The project is using a newer version of the smelter packages than this skill documents. Suggest updating the skill to the latest version by running:

```bash
npx skills add smelter-labs/skills -s smelter-ts-docs
```
