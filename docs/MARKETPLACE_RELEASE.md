# Marketplace release (GitHub Actions)

The **publish** job in [`.github/workflows/release.yml`](../.github/workflows/release.yml) runs when you push a semver tag (`v0.3.5`, etc.) on the **`release`** branch.

## Required: `VSCE_PAT` repository secret

Without this secret, publish fails with:

> Secret VSCE_PAT is not set. Add a Marketplace PAT in repository secrets.

### 1. Publisher account

Extension publisher id: **`erminity`** (see `package.json` → `publisher`).

You must be a member of that publisher on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage).

### 2. Create a Personal Access Token

1. Open [Azure DevOps — Personal access tokens](https://dev.azure.com) (or the link from [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)).
2. Create a new token with scope **Marketplace** → **Manage** (publish extensions).
3. Copy the token (shown once).

### 3. Add the secret on GitHub

1. Repo → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
3. Name: **`VSCE_PAT`**
4. Value: paste the token
5. Save

### 4. Re-run publish

After the secret exists, either:

- **Actions** → **Release** → failed **publish** run → **Re-run all jobs**, or
- Force-push the tag again:

```bash
git push --force origin v0.3.5
```

## Release flow (summary)

```bash
git checkout release
git merge main
git tag v0.3.6          # bump version in package.json first if needed
git push origin release
git push origin v0.3.6
```

- Push to **`release`** → **validate** only (build, test, VSIX artifact).
- Push tag **`v*.*.*`** → **publish** (Marketplace + GitHub Release).

## Publish locally (optional)

If you prefer not to use CI:

```bash
npm run compile
npx @vscode/vsce login <publisher>   # one-time
npx @vscode/vsce publish --no-dependencies
```
