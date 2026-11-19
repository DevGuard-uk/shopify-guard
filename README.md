# DevGuard Shopify Guard (`@devguard/shopify-guard`)

> Official Shopify Theme App Extension and Liquid Guard for agency milestone protection and freelance store handover governance.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Shopify CLI](https://img.shields.io/badge/Shopify%20CLI-3.x-green.svg)](https://shopify.dev/docs/apps/tools/cli)
[![Core Web Vitals Safe](https://img.shields.io/badge/Core%20Web%20Vitals-Optimized-brightgreen.svg)]()

---

## 1. Overview

When developing bespoke Shopify storefronts, agencies and freelance developers often face milestone payment delays after transferring store ownership or completing theme customizations.

`@devguard/shopify-guard` provides non-invasive, enforceable agency milestone protection designed natively for the Shopify ecosystem:

- **Shopify Theme App Extension (App Embed)**: Complies with Shopify's latest Theme App Extension standards. Can be enabled, disabled, and configured directly from the Shopify Theme Editor without modifying underlying theme code.
- **Manual Liquid Snippet Fallback**: Works on older vintage themes or direct Git-managed theme repositories.
- **Three Lock Modes**:
  - `full_lock`: Unclosable responsive overlay with anti-tamper `MutationObserver` preventing DOM removal.
  - `checkout_only`: Disables cart submission buttons and checkout links, displaying an alert banner while allowing catalog browsing.
  - `banner_only`: Renders a non-disruptive fixed top notification for gentle payment reminders.
- **Enterprise Fail-Safe Open**: Network timeouts or upstream API interruptions will **never** disrupt storefront operations unless explicitly configured to fail closed.
- **Preserved Core Web Vitals**: Status evaluations are cached in browser `sessionStorage` with a 60-second TTL to avoid redundant round-trips during shopper navigation.

---

## 2. Package Architecture

```text
.
├── shopify.extension.toml               # Shopify CLI Theme App Extension manifest
├── blocks/
│   └── devguard_theme_guard.liquid      # App Embed Block with schema settings
├── snippets/
│   └── devguard-manual-embed.liquid     # Standalone Liquid snippet for theme.liquid
├── assets/
│   ├── devguard-shopify.js              # Client runtime (anti-tamper, lock modes, caching)
│   └── devguard-shopify.css             # Responsive overlay, banner, & disabled checkout styles
├── package.json                         # Package manifest
└── README.md                            # Integration & deployment guide
```

---

## 3. Installation & Deployment

### Method A: Shopify Theme App Extension (Recommended)

1. **Deploy to Shopify Partner App**:
   Using the Shopify CLI from the root of this extension repository:
   ```bash
   shopify app deploy
   ```

2. **Enable App Embed in Shopify Theme Editor**:
   - Open your Shopify Admin → **Online Store** → **Themes**.
   - Click **Customize** on the target theme.
   - Click on the **App embeds** tab on the left sidebar.
   - Toggle **DevGuard Protection** to **ON**.
   - Fill in your settings:
     - **DevGuard Project ID**: Your project ID (e.g., `proj_live_abc123`).
     - **DevGuard API Gateway**: Default is `https://api.devguard.uk`.
     - **Fail-Safe Mode**: `Fail Open (Recommended)` or `Fail Closed`.
     - **Lock Mode**: `Full Store Lock`, `Checkout Only Lock`, or `Warning Banner Only`.
   - Click **Save**.

---

### Method B: Manual Liquid Snippet Integration

For merchants or agencies modifying theme source code directly:

1. Copy `snippets/devguard-manual-embed.liquid` into your theme's `snippets/` folder.
2. Copy `assets/devguard-shopify.js` and `assets/devguard-shopify.css` into your theme's `assets/` folder.
3. In `layout/theme.liquid`, add the snippet immediately before the closing `</body>` tag:

```liquid
{% render 'devguard-manual-embed',
  project_id: 'your_devguard_project_id',
  api_url: 'https://api.devguard.uk',
  lock_mode: 'full_lock',
  fail_safe: 'open'
%}
```

---

## 4. Lock Modes Explained

| Mode | Target Behavior | Best For |
|---|---|---|
| `full_lock` | Renders a full-viewport blur overlay with anti-tamper observer, preventing all store navigation. | Past-due final handover payments where agency access has been revoked. |
| `checkout_only` | Disables `/cart` forms and checkout links while allowing visitors to browse catalog products. | Preserving SEO and store presence while halting commercial transactions. |
| `banner_only` | Displays a persistent top notification banner without halting store operations. | Upcoming invoice due dates or courtesy grace periods. |

---

## 5. Security & Anti-Tamper Safeguards

1. **DOM Anti-Tamper Observer**:
   In `full_lock` mode, a native `MutationObserver` continuously watches the DOM tree. If a client uses browser DevTools to delete `#devguard-lock-overlay` or modify CSS `display: none`, the observer immediately re-injects the overlay and locks viewport scrolling.

2. **Cart & Checkout Interception**:
   In `checkout_only` mode, form submit and click events targeting `/cart` or `/checkout` are captured at the window capture phase (`true`), halting navigation even if merchant scripts attempt programmatic submission.

3. **Fail-Safe Open Guarantee**:
   If the DevGuard API cannot be reached due to DNS or network latency, the runtime silently falls open by default, guaranteeing zero downtime for the merchant's live shoppers.

---

## 6. Integration Checklist

- Ensure the **App Embed** is toggled to ON under Shopify Theme Editor ➔ App embeds.
- Verify `project_id` corresponds to your active DevGuard Project ID.
- Confirm fail-safe behavior meets client requirements before final store handover.

---

## 7. License

MIT © DevGuard Licensing Systems.
