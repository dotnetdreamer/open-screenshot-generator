# Mac App Store preparation

The [App Store Connect record](https://appstoreconnect.apple.com/apps/6822657542/distribution/macos/version/inflight) is prepared for a free public release. Version 1.0.0 remains in Prepare for Submission, with manual release selected. Five screenshots and the signed universal build, version 1.0.0 (1), are saved in the draft. The app has not been submitted.

## Saved listing

The English listing copy is in [metadata.en-US.json](metadata.en-US.json), including the description, promotional text, keywords, URLs, copyright, and review notes.

| Field | Value |
| --- | --- |
| Name | Open Screenshot Generator |
| Subtitle | App mockups and preview videos |
| Platform | macOS |
| Bundle ID | `com.dotnetdreamer.openscreenshotgenerator` |
| SKU | `open-screenshot-generator-macos` |
| Apple ID | `6822657542` |
| Primary language | English (U.S.) |
| Primary category | Graphics & Design |
| Secondary category | Developer Tools |
| Price | Free in all 175 configured countries and regions |
| Distribution | Public, including future countries and regions |
| Release | Manual after approval |
| Age rating | 13+ globally, with regional ratings of 16+ and 15+ |
| Public support email | `pak437337@live.com` |
| Support and privacy choices URL | `https://openscrgen.app/support` |
| Privacy policy URL | `https://openscrgen.app/privacy` |

Review contact details reuse the contact from the existing Mac app. The private review phone number is stored in App Store Connect only. Sign-in is not required for the core editor.

Claude Code and Codex are excluded from the product description because the sandboxed Mac App Store edition disables them. Preview video export needs a supported macOS version. Validate that feature in the signed build before submission.

The age questionnaire includes user-generated content, social media, and communication through community comments. Parental controls, age assurance, unrestricted web access, and desktop advertising are marked absent. Templates include infrequent alcohol references and fitness or wellness topics. Other content and gambling categories are marked absent. No rating override is selected. Apple applies regional ratings and a 12+ global rating on operating systems earlier than version 26.

## Published privacy label

The label in [App Privacy](https://appstoreconnect.apple.com/apps/6822657542/distribution/privacy) was published on October 14, 2026. All fifteen categories were read back before publication. The published status was verified after reload, and the privacy requirement no longer appears when selecting Add for Review.

| Data type | Purpose | Linked to identity | Used for tracking |
| --- | --- | --- | --- |
| Name | App Functionality | Yes | No |
| Email Address | App Functionality, Third-Party Advertising | Yes | Yes |
| User ID | App Functionality, Analytics, Product Personalization, Third-Party Advertising | Yes | Yes |
| Device ID | App Functionality, Analytics, Product Personalization, Third-Party Advertising | Yes | Yes |
| Product Interaction | App Functionality, Analytics, Product Personalization, Third-Party Advertising | Yes | Yes |
| Search History | App Functionality | Yes | No |
| Other Diagnostic Data | App Functionality | Yes | No |
| Photos or Videos | App Functionality, Product Personalization, Other Purposes, Third-Party Advertising | Yes | Yes |
| Audio Data | App Functionality | Yes | No |
| Other User Content | App Functionality, Product Personalization, Other Purposes, Third-Party Advertising | Yes | Yes |
| Coarse Location | App Functionality, Product Personalization, Third-Party Advertising | Yes | Yes |
| Browsing History | Analytics, Third-Party Advertising | Yes | Yes |
| Advertising Data | Analytics, Third-Party Advertising | Yes | Yes |
| Crash Data | App Functionality | Yes | No |
| Performance Data | App Functionality | Yes | No |

The label covers the app's own services and the optional remote AI providers. Accounts retain provider identifiers, names, email addresses, and profile information. Signed-in cloud auto save defaults on and uploads project content, referenced media, and fonts. Community posts, comments, likes, saves, and follows associate with the account. The following and saved feeds use those interactions to personalize content. The app's own desktop Google Analytics and AdSense are disabled.

Discover search text is included in request URLs. The supplied Caddy configurations retain those URLs and IP addresses without anonymization. The pinned PocketBase version also logs request metadata and IPs. Search History and Other Diagnostic Data therefore use App Functionality and remain linked to identity. Exact deployed retention and backup expiry still need confirmation; the privacy label does not promise a retention period.

The sandboxed Mac edition permits fixed provider webviews and remote AI APIs. Apple's [webview disclosure rule](https://developer.apple.com/app-store/app-privacy-details/) applies to those workflows. [OpenAI's marketing practices](https://help.openai.com/en/articles/20001156-how-we-promote-openai-on-third-party-properties) describe sharing identifiers, hashed email, and interaction or browsing information with advertising partners. [Microsoft's privacy statement](https://www.microsoft.com/en-us/privacy/privacystatement) describes Copilot advertising that uses conversation history, shared files, and location alongside other data. The tracking answer for screenshot attachments is a conservative inference from that combined history use, rather than a claim that every provider shares raw photos with advertisers.

[Gemini's privacy notice](https://support.google.com/gemini/answer/13594961?hl=en) and [DeepSeek's privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) support the approximate location, identifier, performance, and crash categories. Other Purposes covers provider model training where enabled. On-device editing, exports, and local Ollama or LM Studio processing alone are not collection under Apple's definition.

Code references: [cloud uploads](../../src/lib/cloud/api.ts), [cloud preferences](../../src/lib/editorPreferences.ts), [community API](../../src/lib/discover/api.ts), [account verification](../../src/lib/discover/session.ts), [backend account records](../../infra/vps/pb-hooks/lib/openscreengen.js), [request logging](../../infra/vps/Caddyfile), [embedded provider sites](../../src-tauri/src/web_session.rs), and [desktop analytics exclusion](../../src/lib/analytics.ts).

## Supporting website pages

[Support](../../website/support.html) provides the confirmed email and help with local projects and account deletion requests. [Privacy](../../website/privacy.html) describes current local storage, optional cloud and connected services, community content, collaboration, AI, translation, and web analytics. [Terms](../../website/terms.html) no longer promises that accounts and a backend do not exist.

The public privacy page includes the accounts, cloud storage, community, and network logging disclosures. The provider advertising details added during this privacy audit are still local and need deployment. Vercel's configured `cleanUrls` serves `support.html` at `/support`.

## Remaining submission work

- [Desktop packaging instructions](../DESKTOP.md#mac-app-store-macos) describe the Store overlay and future uploads.
- Deploy the provider advertising additions to the privacy page. Set the actual log and backup retention policy and confirm how deletion affects backups. The backend has account deletion, but no user-facing in-app deletion control was found. Validate account sign-in and deletion requirements if those features ship.
- Complete Content Rights after confirming redistribution rights for the shipped artwork. The owner answered "Not yet confirmed" on October 14, 2026. [THIRD-PARTY-ASSETS.md](../../THIRD-PARTY-ASSETS.md) records incomplete provenance for 98 root template PNGs, 101 previews, and 150 app, Mac, or watch placeholders. Adobe Stock images have separate standard licenses whose permitted use needs checking for the shipped editable library. The Content Rights attestation remains unanswered.
- Complete encryption documentation for the actual binary. The current HTTP plugin bundles rustls and ring, so select standard encryption implemented in addition to Apple's operating system encryption. No proprietary algorithms were found. France is selected for distribution. Apple's [encryption documentation table](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/) calls for a French declaration for that configuration. No declaration or Apple compliance code is present locally.
- Validate native exports, online features, and loopback OAuth or MCP functionality in the signed sandbox. The signed entitlements include both network client and server permissions. The server permission is explained in App Store Connect for the loopback OAuth callback and optional local MCP service. Make accessibility claims only after evaluating the shipped interface.

App Store Connect also displays an updated Paid Applications Schedule notice for the account. The free listing can be prepared, but any account agreement requirement shown at submission must be resolved by the Account Holder.

## Validation

Saved listing fields and review details were read back after reload. Free prices were verified for all 175 configured regions, and availability is set for app release. Website HTML, links, and desktop and mobile rendering checks passed. The UI copy check and `git diff --check` passed. Typecheck remains blocked by unrelated dependencies and type errors in `promo` and `promo-i18n`; this preparation changes no application code.

## Signed build

Version 1.0.0, build 1 was built on October 14, 2026 for Apple Silicon and Intel.
The app signature passes `codesign --verify --deep --strict`. The embedded Mac
App Store profile matches team `9XCZL2PPRH`, the app identifier, and the installed
Apple Distribution certificate. The profile expires August 5, 2027 and is kept
in the ignored `src-tauri/embedded.provisionprofile` file. Both team identifiers
are configured in `Entitlements.plist`.

The signed installer is
`src-tauri/target/universal-apple-darwin/release/bundle/pkg/Open Screenshot Generator_1.0.0_1.pkg`.
Its SHA-256 is `9c9073312ba42a75693cea7cc9201af74e6333cab0e3f890421bc5ecf687206d`.
The package uses the existing Mac Installer Distribution certificate. Private
signing keys, the provisioning profile, and build artifacts are not committed.

Apple validation and upload both succeeded with no errors. The upload delivery
UUID is `a64828aa-2e05-4feb-83ea-b535b39dab58`. Apple processing completed with
build and import status `VALID`. Build 1.0.0 (1) is selected and saved in the
version draft. The draft no longer displays `Missing Compliance`; the encryption
selection was changed outside this preparation and has not been independently
verified. On October 14, 2026, Add for Review was retried after publishing privacy.
Apple reported only the missing Content Rights information. The app remains in
Prepare for Submission.
