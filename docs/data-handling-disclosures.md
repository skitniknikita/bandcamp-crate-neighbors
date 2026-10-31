# Chrome Web Store data and permission disclosures

Prepared for **Crate Neighbors for Bandcamp 0.1.1**. These statements describe the code's behavior; the publisher must use the matching current fields in the submission dashboard.

## Single purpose

Help users discover music and collectors on Bandcamp by comparing their purchases and wishlist with public supporter collections and explaining the resulting matches.

## Data handled

The extension handles user data locally. It must not be declared as “handles no data” merely because processing happens in the browser. Chrome's [user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) explicitly includes local handling.

| Data | Purpose and destination |
| --- | --- |
| Profile usernames, display names, IDs, URLs and pictures | Identify the connected profile and matching collectors; stored locally |
| Music collection and wishlist metadata | Compare collections and exclude known releases; stored locally |
| Followed-collector IDs | Exclude people already followed; stored locally |
| Public supporter lists and collection metadata | Discover and compare candidates; stored locally |
| Account-relative shared-purchase total | Used only for a matching signed-in viewer; stored with that connected profile, excluded from shared cache |
| Current Bandcamp page URL and page metadata | Identify the user-selected profile or release; no browser-history database is read |
| Queue state, hidden results, language and scan settings | Save and resume the local user experience |

The relevant disclosure categories are **Personally identifiable information** (profile identifiers and display information) and **Website content** (music/profile metadata). The code does not build browsing-history or activity-tracking datasets. It does not collect payment amounts, receipts, bank/card details, health data, personal communications, or location data.

Authentication cookies remain under browser control. Requests may use the existing session only with Bandcamp. The extension does not use the cookies API, ask for a password, extract authentication secrets, or persist them. Explain this session use in the dashboard rather than claiming that logged-in requests are anonymous.

No collections, match results, or usage telemetry are sent to the publisher, a developer backend, advertisers, or analytics services. Artwork loads from the platform's CDN. There is no sale, advertising use, creditworthiness use, or unrelated transfer of handled data.

## Permissions

| Permission | Paste-ready justification |
| --- | --- |
| storage | Save language preferences in extension-local storage. Collection, result and queue data also remain local in the browser. |
| alarms | Wake the extension to continue a persisted scan queue after the service worker is suspended. |
| sidePanel | Display collection matches, music discoveries and queue progress beside the user's current page. |
| activeTab | Read the current tab only after the user's action to identify an open Bandcamp profile or release. |
| scripting | Inject the packaged page-context reader on a supported page when it is not already present, such as a page open before installation. |
| https://bandcamp.com/* and https://*.bandcamp.com/* | Read public profiles, music collection/wishlist metadata and release supporter data needed for the discovery feature, using the existing Bandcamp session when applicable. |

No access to all websites, browser history, payment services or password stores is requested. All executable code is bundled; there is no remotely hosted code.

The extension has a visible local-data notice before profile connection. Use the [official privacy-fields guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) when entering the single purpose, permission justifications, and data answers.

## Public URLs

- Homepage: https://skitniknikita.github.io/bandcamp-crate-neighbors/
- Privacy: https://skitniknikita.github.io/bandcamp-crate-neighbors/privacy.html
- Support: https://github.com/skitniknikita/bandcamp-crate-neighbors/issues

The separately hosted website is static GitHub Pages content with no added analytics scripts or tracking cookies. GitHub processes hosting requests and public issue submissions under its own [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Extension music data is not uploaded to GitHub.
