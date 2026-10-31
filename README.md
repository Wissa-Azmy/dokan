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
| `data.js` | Batched writes (create shop) |
| `auth.js` | Sign in, sign up, password reset |
| `screens.js` | Header, shop list, new shop, shop home, preferences |
| `app.js` | Start-up, listeners, hash routing, offline banner |
| `firestore.rules` | Security rules |
| `firebase.json` | For the Firebase CLI / emulator (optional) |

## Firebase setup (one time)

1. **Create the project.** Go to https://console.firebase.google.com → *Create a project* → name it `dokan` → Google Analytics is optional (you can turn it off) → *Create project*.
2. **Add a web app.** On the project overview, click the web icon `</>` → nickname `dokan-web` → leave *Firebase Hosting* unticked → *Register app*. Copy the `firebaseConfig` values shown into `config.js`, replacing every `PASTE_…` value. (You can find them again later under ⚙️ *Project settings → General → Your apps*.)
3. **Turn on email sign-in.** *Build → Authentication → Get started → Sign-in method → Email/Password →* turn on the first switch (leave "Email link" off) → *Save*.
4. **Authorize your domain.** *Authentication → Settings → Authorized domains → Add domain →* `wissa-azmy.github.io` → *Add*. (`localhost` is already there.)
5. **Create Firestore.** *Build → Firestore Database → Create database →* choose **Standard edition** if asked → Database ID: keep `(default)` (the free quota only applies to the default database) → Location: pick one close to Egypt, for example `europe-west1 (Belgium)` or `eur3 (Europe)`. **The location can't be changed later.** → Start in **production mode** → *Create*.
6. **Publish the rules.** *Firestore Database → Rules* tab → delete everything there → paste the whole content of `firestore.rules` → *Publish*. Do this again every time `firestore.rules` changes.
7. *(Recommended)* **Restrict the API key.** Google Cloud console → *APIs & Services → Credentials →* the "Browser key (auto created by Firebase)" → *Application restrictions: Websites* → add `https://wissa-azmy.github.io/*` and `http://localhost/*` → *Save*. It can take a few minutes to apply.

## Free plan limits (Spark)

Firestore: 1 GiB stored, 50,000 reads, 20,000 writes and 20,000 deletes per day. The app is designed to stay well under this for a small shop. Product photos are not in v1 because Firebase Storage now needs the paid Blaze plan.
