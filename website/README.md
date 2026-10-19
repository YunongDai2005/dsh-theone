# TheOne product website

Chinese-first, dependency-free static landing page. Source is isolated in `website/`; plugin code and release workflows are unchanged.

## Build and preview

Run `npm run build` then `npm run preview` inside this directory. Preview: http://127.0.0.1:4173. Generated `out/` is ignored by Git. Node 22.16+ is supported; Node 24 is recommended.

The illustration uses a local 30-second timeline: typing, sending, thinking and streamed replies in one persistent conversation. It preserves earlier messages and illustrates returning to the original topic. Pause, offscreen freezing and reduced motion are supported. It makes no model or network calls. The page has no analytics, forms or runtime secrets.

Inter and Noto Sans SC subsets are self-hosted. Font sources and SIL OFL notices are in `fonts/`. Native Apple fonts are only referenced through system fallback names, not distributed. The DSH logo identifies the illustrated application; `HARNESS-LICENSE.txt` preserves the official project's MIT notice. The page states that TheOne is independently maintained.

## Existing Git-backed deployment

- Repository: `YunongDai2005/dsh-theone`
- Production branch: `website/theone-landing`
- Cloudflare Pages project: `theone-website`
- Root: `website`; build: `npm run build`; output: `out`
- Public URL: https://theone-website-f03.pages.dev/
- Requested custom domain: `theone.yulid.org`; its activation is still pending separate authorization.

Pushes to this branch trigger the existing Pages integration. No workflow, project permissions, DNS or main-site settings are changed by this revision. The existing optional Workers configuration is inactive.

## Rollback reference

The preceding published version is commit `2ccd69aa2f200b3a42952338d7f73f75707c684c`. Preserve it in history. Revert a later website commit through a new commit if needed; do not force-push or reset the shared branch.

## Validation

1440px, 390px and 320px layouts were checked locally. Continuous input/reply progression, retained history, topic restoration, pause/offscreen clocks, reduced motion and hero scroll tilt were verified. Browser errors were absent, and the static production build passed. Review screenshots and temporary test artifacts are intentionally outside this repository.
