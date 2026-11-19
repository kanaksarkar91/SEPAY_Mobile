# SE Pay — Google Play Store Direct Production Upload

Short guide for uploading **SE Pay** directly to **Production** on an existing Google Play Developer account (no internal/closed testing track).

---

## 1. App Info (from `app.json`)

| Field | Value |
|---|---|
| **App Name** | `SE Pay` |
| **Package Name** | `com.syscentric.taptopay` |
| **Version / Code** | `1.0` *(update `app.json` from `1.6` before production build; EAS auto-increments `versionCode`)* |
| **Target / Min SDK** | Target `36` / Min `30` |
| **Key Permissions** | Location, Bluetooth, NFC (Stripe Terminal / Tap to Pay) |

---

## 2. Build the Production `.aab`

> Check your production environment variables (`EXPO_PUBLIC_BACKEND_URL`, `EXPO_PUBLIC_SIMULATED_READER=false`) in EAS/project settings before building.

```bash
eas build --platform android --profile production
```

Download the generated **`.aab`** file from EAS when the build finishes.

---

## 3. Checklist to Prepare Before Opening Play Console

Fill in or keep these files ready for the browser upload:

- [ ] **Signed `.aab` file:** `__________________________`
- [ ] **Short description (max 80 chars):** `__________________________`
- [ ] **Full description (max 4,000 chars):** `__________________________`
- [ ] **App icon (512 × 512 PNG):** `assets/icon.png` (verify 512×512)
- [ ] **Feature graphic (1024 × 500 PNG/JPG):** `__________________________`
- [ ] **Phone screenshots (min 2):** `__________________________`
- [ ] **Support email:** `__________________________`
- [ ] **Privacy Policy URL:** `__________________________`
- [ ] **Demo / Reviewer login credentials** *(if login is required)*: `__________________________`

---

## 4. Direct Production Upload Steps (Built-in Browser)

1. **Open & Sign In:** Open `https://play.google.com/console` in the built-in browser and sign in manually (including 2FA).
2. **Create or Open App:** Click **Create app** (App name: `SE Pay`, Free, App) or open your existing `SE Pay` draft.
3. **Store Listing:** Go to **Grow users → Store presence → Main store listing** → add title, descriptions, icon, feature graphic, and screenshots.
4. **App Content (Required Policy Forms):** Go to **Monitor and improve → Policy and programs → App content** and complete:
   - Privacy policy
   - App access (reviewer login if needed)
   - Ads declaration
   - Content rating questionnaire
   - Target audience
   - Data safety (location, payment/account data)
   - Financial features declaration (required for payment apps)
5. **Production Release:**
   - Go to **Test and release → Production**
   - Select **Countries / regions**
   - Click **Create new release**
   - Upload the **`.aab`** file
   - Add release notes → **Save** → **Next**
6. **Review & Publish:** Check for any warnings, then click **Send changes for review** (or **Start rollout to Production**).
