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
| `scanner.js` | Camera barcode scanning (html5-qrcode, loaded on first use) |
| `receipt.js` | Receipt on screen, WhatsApp / share text, 58 or 80 mm printing |
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
