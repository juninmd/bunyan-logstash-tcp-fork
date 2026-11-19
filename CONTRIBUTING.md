# Contributing Guidelines

Thank you for contributing to **bunyan-logstash-tcp-fork**! This document outlines the development workflow, CI/CD pipeline expectations, and quality standards.

---

## Development Setup

**Requirements:**
- Node.js >= 18.0.0 (pinned via `.nvmrc`)
- Yarn 1.x (v1 lockfile format)

**Install:**
```bash
yarn install --frozen-lockfile
```

**Scripts:**
```bash
yarn run build        # Compile TypeScript to dist/
yarn run lint         # Biome check on src/
yarn run lint:fix     # Biome check with auto-fix
yarn run mocha        # Run compiled tests in dist/test/
yarn test             # Lint + coverage (nyc + mocha)
```

---

## CI/CD Pipeline (Central Orchestrator)

All CI/CD runs on the internal Kubernetes cluster via the central orchestrator (`juninmd/base-actions`). GitHub Actions workflows are **not** used in this repository.

### Pipeline Stages

| Stage | Trigger | Description |
|-------|---------|-------------|
| **Lint** | PR opened/updated, push to `main`/`develop` | `biome check src` — strict linting, formatting, import organization |
| **Type Check** | PR opened/updated, push to `main`/`develop` | `tsc --noEmit` — strict TypeScript compilation |
| **Test** | PR opened/updated, push to `main`/`develop` | `yarn test` — unit tests with **≥ 80% coverage** (enforced by `nyc`) |
| **Build** | PR merged to `main` | `yarn run build` — produces `dist/` with declarations & source maps |
| **Security Audit** | Weekly (cluster CronJob) | `yarn audit` + `npm audit` — dependency vulnerability scan |
| **Publish** | Tag `v*` pushed to `main` | Automated `npm publish` with provenance (via central release pipeline) |

### Quality Gates (Enforced by Orchestrator)

- **Linting**: Biome `recommended` preset + `noExplicitAny: error`
- **Type Checking**: `strict: true`, `noEmit` validation
- **Coverage**: Minimum 80% statements, branches, functions, lines
- **Security**: No `critical`/`high` vulnerabilities allowed in `dependencies`
- **Formatting**: `biome check` must pass (CI runs `--write` locally via pre-commit)

### Local Pre-Commit Hook (Recommended)

Install Husky to run lint + type-check before commit:

```bash
yarn add -D husky
yarn husky install
yarn husky add .husky/pre-commit "yarn run lint && yarn run build"
```

---

## Pull Request Process

1.  **Branch from `develop`** (or `main` for hotfixes).
2.  **Write tests** for new behavior (target ≥ 80% coverage).
3.  **Run locally**: `yarn test` must pass.
4.  **Open PR** against `develop` (or `main` for hotfixes).
5.  **CI runs automatically** via the central orchestrator.
6.  **Review required**: At least one approval; CI must be green.
7.  **Squash & merge** — conventional commit message (`feat:`, `fix:`, `chore:`, etc.).

---

## Code Style & Conventions

- **Language**: TypeScript (strict mode), CommonJS output.
- **Linting/Formatting**: Biome (config in `biome.json`).
- **Naming**:
  - Classes: `PascalCase`
  - Functions/Variables: `camelCase`
  - Types/Interfaces: `PascalCase`
- **Architecture**: SOLID, DRY, KISS — one module per feature, explicit dependencies.
- **Tests**: Mocha + Chai + Sinon; colocated in `src/test/*.test.ts`.
- **Commits**: Conventional Commits (enforced by central release tooling).

---

## Release Process

Releases are automated by the central orchestrator (`juninmd/base-actions/.github/workflows/release.yml@main`) when a version tag is pushed:

```bash
# From main branch, after PR merged:
yarn version patch|minor|major   # updates package.json, creates git tag
git push origin main --tags      # triggers release pipeline
```

The pipeline:
1.  Validates the tag matches `v*` and `package.json` version.
2.  Runs full CI (lint, type-check, test, build).
3.  Publishes to npm with provenance (`npm publish --provenance`).
4.  Creates GitHub Release with changelog (from `CHANGELOG.md`).
5.  Updates `latest` dist-tag.

---

## Security

- Report vulnerabilities privately via GitHub Security Advisories.
- Dependencies audited weekly by cluster CronJob.
- No secrets in code or logs; TLS certificates loaded at runtime from filesystem.

---

## Questions?

Open a GitHub Discussion or ping `@juninmd` on the PR.