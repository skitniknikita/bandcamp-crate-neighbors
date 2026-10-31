# Release checklist — Crate Neighbors for Bandcamp

## Build and validation

- Run typecheck, unit tests, the production build, and isolated browser checks.
- Verify installation in Chrome 120+ and both interface languages.
- Check profile detection, purchases, wishlist, followed collectors, and pagination.
- Verify novel-release exclusions, duplicate reasons, pause/resume, restart, hidden choices, and profile isolation.
- Check trusted full purchase totals against the platform; verify lower-bound sample labels for other connected profiles.
- Check the two-purchase filter, count refresh without loss of loaded data, and list batches of 20.
- Verify that no authentication cookies, authentication tokens, raw HTML, download links, payment details, or personal validation screenshots enter the public package or repository.

Product behavior has been checked in isolated fixture and public-page browser scenarios. Signed-in behavior, persistence, and shared-purchase totals have also been checked in Chrome. Public evidence and images must use approved example data; private validation artifacts stay outside the repository.

## Package and public links

- Confirm the release version matches the manifest and documentation.
- Attach `bandcamp-crate-neighbors-0.1.1.zip` to the corresponding GitHub release.
- Check ZIP integrity, icons, packaged font licenses, and the bundled privacy policy.
- Verify the homepage, privacy, support, release download, and image URLs after deployment.
- Verify desktop and mobile layouts and HTML metadata.
- Confirm GitHub Pages serves the docs folder without requiring authentication.

## Chrome Web Store

- Use [store-listing.md](store-listing.md) and [data-handling-disclosures.md](data-handling-disclosures.md).
- Provide the real publisher account and support contact required by the dashboard.
- Ensure the submitted privacy answers match runtime behavior and the public policy.
- Use only approved example-data screenshots and original promotional assets.
- Publishing to GitHub does not publish an extension to Chrome Web Store. Store submission, any registration payment, and store publication require their own authorization.

## Search discoverability

The site provides descriptive titles, crawlable HTML, canonical and language-alternate links, social metadata, a sitemap, and factual software structured data. Verify the live pages and optionally submit the sitemap through a verified Search Console property.

Indexing, ranking, and rich results remain search-engine decisions. Publishing metadata does not confirm inclusion in Google. Google explains this in its [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

GitHub project Pages serves this site's robots.txt under the project path. Search engines normally read robots.txt only at the origin root; do not rely on that project-path file as a host-wide crawl rule.
