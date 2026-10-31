# Store images

Run node scripts/store-assets.mjs from the project root after npm ci. Playwright uses installed Google Chrome on macOS, or its Chromium otherwise. CHROME_PATH selects an executable; STORE_ASSET_PORT overrides isolated Vite port 5186.

- en/01–05 and ru/01–05: localized 1280×800 screenshots in upload order.
- promo-small-440x280.png: small promotional tile.
- promo-marquee-1400x560.png: marquee image.
- social-og-1200x630.png: website/social preview.
- raw/onboarding-en.png and raw/onboarding-ru.png: unmodified product onboarding, empty isolated state, no collection data.
- Other raw/ files are component captures used in compositions, not store uploads.
- ../public/icons/icon-128.png: transparent icon with 16px horizontal padding and 96px artwork. Other sizes share the mark and normalized padding.

Collection views are explicitly labelled examples. No private profiles, authorization artifacts, external artwork, fabricated ratings or testimonials are used. The full-count example separates the Bandcamp purchase count from sampled titles and does not claim a global wishlist counter. See assets-manifest.json for dimensions, captions, provenance and store fields.
