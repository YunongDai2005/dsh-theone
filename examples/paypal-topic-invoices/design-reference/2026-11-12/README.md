# Frozen visual reference — November 12, 2026

This archive records the earlier frontend freeze during backend repair. The user subsequently requested merging the new web frontend with the repaired backend. `manifest.json` retains the original checkpoint metadata; the matching historical source is now saved here as `index.html`. Its old `frontend_file` path describes the file location at the freeze checkpoint, not the current live interface. The active version and source hash are in [the merged Invoice Desk baseline](../2026-11-12-invoice-desk/README.md).

- `paypal-app-store/manifest.json`: source URLs for eight screenshots observed on the [official US PayPal App Store listing](https://apps.apple.com/us/app/paypal-pay-send-save/id283646709), which showed version 10.11.0 at this checkpoint. Downloaded copies are retained only as local research and excluded from the published repository. The manifest uses local basenames, with official asset URLs available for reference. These third-party images are not application assets or an endorsement.
- `paypal-one-english-dark.jpg`: the frozen local English, dark mobile invoice concept.
- `paypal-one-invoice-review.jpg`: its invoice review sheet.
- TheOne visual identity is pinned to **v0.4.6**, commit `00a552bf6a5dea281543d8d89a346968c05fc692`. Cell geometry, the wordmark and ice-blue dark tokens follow `src/client.ts` at that release.

The concept has no marketing slogan, promotional home page or profile page. Its scope is a conversation, draft list, project picker and invoice review. It is an independent local prototype. The charcoal/blue/ice-blue palette describes this historical concept.

Sources:
- https://apps.apple.com/us/app/paypal-pay-send-save/id283646709
- https://github.com/YunongDai2005/dsh-theone/blob/v0.4.6/src/client.ts
- https://paypalaihackathon.devpost.com/rules (English materials or English translations)
