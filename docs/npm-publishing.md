# Publishing TheOne to npm

The package name is `dsh-theone`. A GitHub Release alone does not add a package to npm.

## First publication

From the repository checkout of the version you want to publish, using Node.js 24:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run pack:plugin
npm login --registry=https://registry.npmjs.org/
npm publish .dsh-test/dsh-theone-0.3.9.tgz --access public --registry=https://registry.npmjs.org/
```

Complete npm's account and two-factor verification in your browser. Publish the archive produced by `pack:plugin`, which checks its contents and excludes local settings and the original `Readme.txt`.

## Enable GitHub publishing

After the first publication, open the package settings on npmjs.com and add a GitHub Actions trusted publisher:

- Organization or user: `YunongDai2005`
- Repository: `dsh-theone`
- Workflow filename: `publish.yml`
- Environment name: leave empty
- Allow direct publishing with `npm publish`

No npm token needs to be stored in GitHub. The workflow uses GitHub's temporary OIDC credentials and publishes with provenance.

Releases can also be made without opening GitHub: push `.github/release-notes/v<version>.md` (first line `# <title>`, then the notes) to `main` together with the matching package version. The workflow tags that commit, creates the GitHub Release with the plugin archive attached, and publishes to npm. It skips anything already released or already on npm.

Merge `.github/workflows/publish.yml` into the default branch before creating a release. Update the package and lockfile version together, then publish a non-prerelease GitHub Release whose tag exactly matches the package version, for example `v0.3.10`. The workflow checks the tag, installs dependencies, checks types, runs tests, builds and publishes the checked archive. Reusing an already published npm version will fail.

For the initial `0.3.9` published locally, do not trigger another npm publication of the same version. Start automatic releases with the next version.

## Check availability

```sh
npm view dsh-theone version --registry=https://registry.npmjs.org/
```

Once the package is available, use `dsh-theone` as the package name with the official npm installation source in DSH. Search indexing may take additional time.

Reference: https://docs.npmjs.com/trusted-publishers/

## Host and browser type checks

DSH declares two different `Context.sessions` services: the Host SessionStore and the browser ISessions controller. Check these entry points in separate TypeScript programs (`tsconfig.tests.json` and `tsconfig.client.json`) so declaration merging cannot give browser code the Host service type. `npm run typecheck` checks both programs; `npm run build` emits both before bundling the browser entry. The browser entry remains type checked; no API casts or runtime changes are needed.
