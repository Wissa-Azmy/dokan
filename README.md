# Dokan · دكان

Stock, buying, selling and money for local shops in Egypt. Static site (plain HTML/CSS/JS ES modules, no build step) on GitHub Pages, with Firebase Authentication and Cloud Firestore. Works on the free Spark plan.

Live: https://wissa-azmy.github.io/dokan/

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell, fonts, sets language/direction before first paint |
| `style.css` | Warm light theme, phone-first form fixes, RTL via logical properties |
| `config.js` | Firebase web config (fill in once) |
| `firebase.js` | Only file that imports the Firebase SDK (v13.1.0); offline cache on |
| `i18n.js` | Arabic/English texts, direction, error messages |
| `format.js` | Number parsing ("6,5", "6.5", ٦٫٥) and EGP/date formatting, digit style |
| `forms.js` | Elements, SVG icons, fields, dialogs, confirmations, toasts |
| `sync.js` | Live listeners; saves profile and settings field by field |
| `data.js` | Batched writes: shop, locations, invites, joining, members |
| `roles.js` | Role checks matching the rules (owner, manager, employee, allowed locations) |
| `auth.js` | Sign in, sign up, password reset |
| `screens.js` | Header, shop list, new shop, shop home, preferences |
| `locations.js` | Branches and warehouses |
| `team.js` | Members, roles, invites, joining with a code or link |
| `categories.js` | Categories and subcategories, markup overrides |
| `products.js` | Product list with search and filters, product form |
| `movements.js` | Every stock change: movement + atomic increment in one batch; history; stock counts |
| `stock.js` | Stock per location, low-stock warnings, adjustments, transfers |
| `count.js` | Shelf-by-shelf stock count and its review |
| `picker.js` | Product search box with barcode-scanner support |
| `buying.js` | Invoice totals, extra costs spread by value, average cost, supplier balances |
| `suppliers.js` | Suppliers, statements, payments |
| `purchases.js` | Purchase list, invoice / goods-receipt form, adding prices, view |
| `selling.js` | Sales, returns, customer payments and day totals (one batch each) |
| `sell.js` | The selling screen: cart, scanning, checkout with split and down payments |
| `scanner.js` | Camera barcode scanning: the browser's own reader, or ZXing (loaded on first use); flashlight, scan cards, typed fallback |
| `barcode.js` | Shop barcodes (EAN-13 starting with 20) and drawing EAN-13 / Code 128 as SVG |
| `labels.js` | Barcodes & stickers: generate missing barcodes, print stickers, barcode reader help and test |
| `receipt.js` | Receipt on screen, WhatsApp / share text, 58 or 80 mm printing; shared print helper |
| `sales.js` | Sales per day and branch, one sale, returns |
| `customers.js` | Customers, credit balances, statements, payments received |
| `pricing.js` | Suggested price formula (dollar pass-through, markup, rounding) and the worked example |
| `fx.js` | Daily USD → EGP rate from two free sources, saved to history and settings |
| `rates.js` | USD rate screen: today, fetch now, type by hand, history |
| `prices.js` | Price check: products below their suggested price, updated in one go |
| `settings.js` | Shop settings, each field saved on its own |
| `expenses.js` | Expenses per branch and month |
| `cash.js` | Cash drawer: open and close the day per branch |
| `dashboard.js` | Dashboard: sales, profit, expenses, stock value, balances, best sellers, 12-month chart |
| `csv.js` | CSV exports (sales, expenses, purchases, products, customers) |
| `backup.js` | Backup to file or cloud, restore, clear transactions, delete shop |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Offline app loading and "Add to Home Screen" |
| `version.js` | `APP_VERSION`: **bump it with every push** so open devices offer "Reload" |
| `loading.js` | Loading view (spinner, status, skeleton, "Try again") and the new-version check |
| `summary.js` | The shop home card: today's sales, cash, low stock, balances, USD rate |
| `app.js` | Start-up, listeners, hash routing, offline banner |
| `firestore.rules` | Security rules |
| `firestore.indexes.json` | Composite indexes (same as the console step below) |
| `RULES-CHECKLIST.md` | What to try by hand to check the rules |
| `tests/rules.test.js`, `package.json` | Automated rules tests on the local emulator (optional) |
| `firebase.json` | For the Firebase CLI / emulator (optional) |

## Firebase setup (one time)

1. **Create the project.** Go to https://console.firebase.google.com → *Create a project* → name it `dokan` → Google Analytics is optional (you can turn it off) → *Create project*.
2. **Add a web app.** On the project overview, click the web icon `</>` → nickname `dokan-web` → leave *Firebase Hosting* unticked → *Register app*. Copy the `firebaseConfig` values shown into `config.js`, replacing every `PASTE_…` value. (You can find them again later under ⚙️ *Project settings → General → Your apps*.)
3. **Turn on email sign-in.** *Build → Authentication → Get started → Sign-in method → Email/Password →* turn on the first switch (leave "Email link" off) → *Save*.
4. **Authorize your domain.** *Authentication → Settings → Authorized domains → Add domain →* `wissa-azmy.github.io` → *Add*. (`localhost` is already there.)
5. **Create Firestore.** *Build → Firestore Database → Create database →* choose **Standard edition** if asked → Database ID: keep `(default)` (the free quota only applies to the default database) → Location: pick one close to Egypt, for example `europe-west1 (Belgium)` or `eur3 (Europe)`. **The location can't be changed later.** → Start in **production mode** → *Create*.
6. **Publish the rules.** *Firestore Database → Rules* tab → delete everything there → paste the whole content of `firestore.rules` → *Publish*. Do this again every time `firestore.rules` changes.
7. *(Recommended)* **Restrict the API key.** Google Cloud console → *APIs & Services → Credentials →* the "Browser key (auto created by Firebase)" → *Application restrictions: Websites* → add `https://wissa-azmy.github.io/*` and `http://localhost/*` → *Save*. It can take a few minutes to apply.
8. **Add the composite indexes.** *Firestore Database → Indexes → Composite → Create index*, once for each row below, with Query scope *Collection*. Each takes a few minutes to build.

   | Collection ID | Field 1 | Field 2 | Used by |
   |---|---|---|---|
   | `movements` | `productId` · Ascending | `at` · Descending | A product's recent movements |
   | `dailyStats` | `locationId` · Ascending | `date` · Ascending | Dashboard for one branch |
   | `sales` | `locationId` · Ascending | `date` · Ascending | Sales CSV export for one branch |
   | `expenses` | `locationId` · Ascending | `date` · Ascending | Expenses of one branch per month |
   | `cashDays` | `locationId` · Ascending | `date` · Descending | Suggesting today's opening cash |

   If a screen ever says it needs an index, the browser console shows the Firebase link that creates it in one click.

## Offline

- **Data:** Firestore keeps a copy on each device. Selling, receiving goods, adjustments, expenses and the cash drawer all work offline and sync when the internet is back.
- **The app itself:** `sw.js` keeps the app files, the Firebase SDK and the font on the device. After the app has been opened online twice, it opens without internet too. App files always load fresh when online, so a new push shows on the next reload.
- **Needs internet:** joining a shop, creating invites, costing a purchase, deleting things with history, exports, backup and restore.

## Barcodes, stickers and barcode readers

### Shop barcodes

Products without a factory barcode can get one made by the shop:

- **One product:** in the product form, tap **Generate barcode**, then **Save**.
- **All at once:** Products → **Barcodes & stickers** → **Generate barcodes for N products**. Only products with no barcode get one; existing barcodes never change.

Shop barcodes are EAN-13 codes starting with **20**. GS1 keeps the 20–29 range for in-store use, so a shop code never clashes with a factory barcode. Every reader and phone camera reads EAN-13. Each shop makes its own codes and checks them against its own products. Generating works offline. Owners and managers can generate; everyone can print.

### Printing stickers

Products → **Barcodes & stickers** (also on the shop home, or **Print stickers** in a product's form):

1. Choose the **sticker size**: a label roll (40 × 30, 50 × 30 or 58 × 40 mm, one sticker per label) or an **A4 sheet** of 3 × 8 stickers (70 × 37 mm). The size and the price setting are remembered on each device.
2. Turn **Show the price** on or off. The sticker always shows the product name and the barcode with its number underneath.
3. Set how many stickers each product needs (− / +, **One of each shown**, or scan a product with a reader to add one).
4. Tap **Print**. In the print window, pick the printer, set **margins to None**, **scale 100 %**, and turn off **headers and footers**.

Codes that are not a valid EAN-13 (for example a 12-digit UPC or a code with English letters) are printed as **Code 128**, which scans back exactly as stored. Codes with Arabic letters can't be printed as a barcode.

**Printers:**
- **Thermal label printer:** for example Xprinter XP-365B or XP-370B, or a TSC or Zebra desktop model. Install its driver, then set the paper size in the driver to the label size (for example 40 × 30 mm).
- **A4 sticker sheets:** any ordinary printer. Check the first page on plain paper, because printers can't print right to the edge.

### Connecting a barcode reader

A barcode reader acts as a keyboard: it types the code and presses **Enter**. Dokan needs no driver or app for it.

| Device | How |
|---|---|
| Windows / Mac computer | Plug in the USB reader (or the USB dongle of a wireless one) and wait a few seconds. |
| Android | Bluetooth (below), or a wired reader through a USB-C OTG adapter. |
| iPhone / iPad | Bluetooth (below). |

**Bluetooth:**
1. Put the reader in **Bluetooth HID** (keyboard) mode by scanning the setup code in its manual.
2. Pair it in the phone's Bluetooth settings.
3. While it is connected, the on-screen keyboard may hide:
   - **iPhone:** double-press the reader's button, or scan the "iOS keyboard toggle" code in the manual.
   - **Android:** turn on "Show on-screen keyboard" under Settings → System → Keyboard → Physical keyboard.

**Where scanning works:**
- **Sell:** the product is added to the cart, even if the search box isn't selected.
- **Stock count and purchases:** use the search box.
- **Barcodes & stickers:** scanning adds a sticker for that product.
- **Without a reader:** use the camera scan button (barcode icon) on the Sell screen. It shows a frame to hold the barcode in, a flashlight button where the phone has one, a card for each scan with how many are in the sale, and a box to type the number.

**If it doesn't work:**
- **Keyboard language:** the device's keyboard must be set to **English**. If Arabic letters appear instead of numbers, that's the cause.
- **Enter after each code:** the reader must add **Enter** after the code (the factory default on most readers).
- **Test box:** Barcodes & stickers → **How to connect a barcode reader** → **Test the reader** shows exactly what the reader typed and which product it matches.
- **Reading from a screen:** a 2D (imager) reader can also read codes shown on a phone screen; a 1D laser reader can't.

## Rules tests (optional)

On your Mac, with Node.js 20+ and Java 11+ installed:

```
cd dokan
npm install
npm test
```

This starts the Firestore emulator, runs `tests/rules.test.js` against `firestore.rules`, and stops it. Nothing touches the live project. `RULES-CHECKLIST.md` covers the same and more by hand.

## Free plan limits (Spark)

Firestore: 1 GiB stored, 50,000 reads, 20,000 writes and 20,000 deletes per day. The app is designed to stay well under this for a small shop. Product photos are not in v1 because Firebase Storage now needs the paid Blaze plan.
