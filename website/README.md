# TheOne product website

Chinese-first, dependency-free static landing page for `https://theone.yulid.org`.
All source lives in `website/`. The plugin's `src/`, `dist/`, package metadata and release workflows are untouched.

## Local build and preview

Use Node.js 24 (also the plugin's documented runtime):

```sh
cd website
npm run build
npm run preview
```

Open http://127.0.0.1:4173. Build output is `website/out/` and is ignored by Git.
No npm dependencies, remote fonts, analytics, model calls, form submission, or runtime secrets.
The product demonstration is the repository's existing Chinese animated WebP, labeled as a README example rather than a live AI session. Pause/play and original-size viewing are provided; reduced-motion preferences start it paused.

## Git-backed deployment proposal — not yet activated

Source branch: `website/theone-landing` in `YunongDai2005/dsh-theone`.
Do not deploy the repository root or plugin `dist/` as the website.

### Cloudflare Pages

Create a separate Git-integrated project (proposed name `theone-website`; availability must be checked):

| Setting | Value |
| --- | --- |
| Repository | `YunongDai2005/dsh-theone` |
| Production branch | `website/theone-landing` |
| Root directory | `website` |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `out` |
| Node version | `24` |
| Build watch path (repository-relative) | `website/*` |
| Preview branches | Disabled unless wanted |
| Custom domain | `theone.yulid.org` |

Do not create a Direct Upload project if Git integration is desired. Configure the domain through the project's Custom domains flow before changing DNS. Proposed DNS, after Cloudflare returns the actual project hostname: **CNAME `theone` → `<actual-project>.pages.dev`, proxied, TTL Auto**. The project hostname is not yet assigned, so no exact CNAME target can truthfully be finalized now. Leave apex, `www`, mail, feedback, and every other record untouched.

The existing Cloudflare GitHub installation may already allow this repository. If it does not, expanding it to `dsh-theone` is a separate persistent authorization change requiring user approval. Do not authorize all repositories or create a token to work around it.

### Existing pattern: Workers Builds

Read-only discovery found `wrangler.toml` in the user's `sirusan---ai-cleanliness-evaluator` repository with Worker name `sirusan` and static assets `./dist`. That establishes a Workers deployment pattern, but does not prove which current Worker serves `yulid.org`; the live apex returns a Yuli Dai portfolio.

If the existing account uses Workers Builds, a separate Worker named `theone-website` can instead use this directory's `wrangler.workers.toml`: root `website`, build `npm run build`, deploy `npx wrangler deploy --config wrangler.workers.toml`, production branch `website/theone-landing`. The custom domain must be added separately after reviewing the Cloudflare-managed DNS change. Do not reuse `sirusan`, change its routes, or deploy from the repository root. No Worker deployment has been performed.

### Vercel alternative

Import the same repository/branch with root `website`, framework Other, build `npm run build`, and output `out`. Confirm new provider authorization before connecting. Do not point DNS at an assumed target; use the exact value returned by Vercel after adding the domain.

## Verification and maintenance

- Copy button writes only the public package name `dsh-theone`; a manual-copy message handles unavailable clipboard access.
- The demonstration replaces the previously invented chat shell. Its asset is copied unchanged from `docs/images/theone-demo-zh.webp` under this repository's MIT license.
- The page is reduced to the core promise, product demonstration and installation. Anchor links work without JavaScript.
- `robots.txt`, sitemap and canonical URL target the requested domain. Publish only after domain configuration is complete.
- `_headers` provides a restrictive CSP on Cloudflare. Other hosts may need their equivalent header configuration.
- Content checked against public v0.3.39 README/release on 2026-10-19. No benchmark numbers or user-count claims are published.
- Existing plugin CI triggers on all pushes; a website branch push therefore runs the existing plugin verification. Its release workflow only publishes from its existing release triggers; this branch does not change them.

Official hosting references: https://developers.cloudflare.com/pages/configuration/git-integration/ and https://developers.cloudflare.com/workers/ci-cd/builds/configuration/.

## Current publication status (2026-10-19)

- Cloudflare Pages project `theone-website` is connected through the existing GitHub installation.
- Public staging hostname: https://theone-website-f03.pages.dev (HTTP 200 verified).
- Production branch `website/theone-landing`, root `website`, command `npm run build`, output `out`.
- The first cloud build used Node 22.16.0 successfully; Node 24 remains the recommended local runtime. No runtime dependency installation is required.
- Requested custom domain is still awaiting DNS approval: CNAME `theone` -> `theone-website-f03.pages.dev`.
- Existing `sirusan` Worker is verified to serve `yulid.org/*` and builds from its own repository's `main`; it is unchanged.
- Optional Worker configuration is named `wrangler.workers.toml` so Pages does not auto-detect it. It is not an active deployment.
- Visual refinement follows inspection of https://www.deepseek.com/harness/: dark blue ambient background, lighter typography and quiet borders. The genuine project demonstration shows DSH branding only inside its application UI; the site retains TheOne identity and an explicit independent-plugin disclosure.

## UI verification evidence (2026-10-19)

- Installed Windows DSH executable reports `0.2.1-rc.2`. After the user opened it, its process and local service were confirmed. Native window capture is unavailable in this session; the local HTTP entry requires DSH authentication. No claim of pixel-perfect comparison with the running window is made.
- Official Harness repository was resolved from the official website and inspected at `687f282e8625c6b8d11ff58211a90524be2e4317`: `SidebarRoot.tsx`, `SidebarRoot.module.css`, `MessageItem.module.css`, theme tokens and brand guidelines.
- TheOne v0.3.39 `src/client.ts` confirms native `uiWorkspace.openSession` use and sidebar/composer slot integration. The demonstrated asset comes from that public repository, not private local conversations. Its older model label is example content, not a current-version claim.
- The user's separate local TheOne checkout reports v0.3.7; it was inspected read-only and is not the website source.
