# SE Pay — Google Play Store Submission Checklist & Content

All ready-to-paste content and assets for direct **Production** upload on Google Play Console.

---

## 1. Release & Version Settings

> **Version 1.0 Note:** Currently `app.json` has `"version": "1.6"` (`versionCode: 7`) and `package.json` has `"version": "1.6.0"`.  
> Before building the production `.aab`, set `"version": "1.0"` in `app.json` so your first Play Store release starts at **v1.0**.

| Field | Value |
|---|---|
| **App Name** | `SE Pay` |
| **Package Name** | `com.syscentric.taptopay` |
| **Release Track** | `Production` (Direct upload) |
| **Version Name** | `1.0` |
| **Release Name** | `1.0` |
| **Signed `.aab` File** | Ready: `playstore-assets/se-pay-v1.0-api36-vc3.aab` (v1.0, versionCode 3, Target SDK 36) |
| **Production Backend URL** | `https://sepay.stageserv.in` |

---

## 2. Main Store Listing

- **App Name (max 30 chars):**
  ```text
  SE Pay
  ```

- **Short Description (78 / 80 chars):**
  ```text
  Accept Tap to Pay contactless payments, track shifts & share digital receipts.
  ```

- **Full Description (max 4,000 chars):**
  ```text
  SE Pay turns your compatible Android device into a fast, secure contactless payment terminal for businesses, staff, and taxi fleets.

  Accept in-person payments anywhere without extra card reader hardware, manage shifts in real time, and deliver branded digital receipts to customers in seconds.

  KEY FEATURES
  • Tap to Pay on Android: Accept contactless debit/credit cards and digital wallets directly on your NFC-enabled Android device, powered by Stripe Terminal.
  • Flexible Payment Options: Support contactless Tap to Pay, card entry, and cash payment recording in one simple workflow.
  • Instant Digital Receipts: View detailed payment receipts and share or export PDF and branded digital receipts with customers.
  • Shift Tracking & Summaries: Start and close shifts, monitor live shift totals, and export shift reports effortlessly.
  • Built for Teams & Fleets: Dedicated workflows for Business Owners, Employees, Taxi Fleet Owners, and Drivers.
  • Team & Driver Management: Add, edit, and oversee employees or drivers with live transaction visibility.
  • Secure by Design: Encrypted payment processing powered by Stripe Terminal with authenticated role-based access.

  REQUIREMENTS
  • An active SE Pay merchant, staff, or fleet account.
  • NFC-enabled Android device (Android 11 / API 30 or higher) with Location and Bluetooth enabled for Tap to Pay contactless transactions.
  ```

- **App Category:** `Business`
- **Free or Paid:** `Free`
- **Tags (up to 5):** `Business`, `Point of Sale`, `Payments`, `Contactless`, `Receipts`

---

## 3. Store Graphics & Media

| Asset | Requirement | Status / Path |
|---|---|---|
| **App Icon** | 512 × 512 PNG (up to 1 MB) | Ready: `playstore-assets/app-icon-512x512.png` |
| **Feature Graphic** | 1024 × 500 PNG/JPG (up to 15 MB) | Ready: `playstore-assets/feature-graphic-1024x500.png` |
| **Phone Screenshots** | 4 screenshots (9:16 / 720×1280) | Ready: `playstore-assets/screenshots-playstore/` (`01-dashboard.png`, `02-payment.png`, `03-history.png`, `04-profile.png`) |

---

## 4. Store Contact & Policy Links

| Field | Value |
|---|---|
| **Support Email** | `setaxibrokers@gmail.com` |
| **Privacy Policy URL** | `https://sepay.stageserv.in/privacy` |
| **Website (Optional)** | *(leave blank unless provided)* |
| **Phone Number (Optional)** | *(leave blank unless provided)* |

---

## 5. App Content & Policy Declarations

### A. App Access
- **All or some functionality is restricted (requires login):** `Yes`
- **Instruction 1 — Business Owner (Primary):**
  - **Name:** `Business Owner Demo`
  - **Username / Email:** `laraShop@gmail.com`
  - **Password:** `Lara@123`
  - **Instructions:** `Sign in on the login screen with these credentials to test the Business Owner dashboard, payment entry, transaction history, digital receipts, shifts, and staff management. Live Tap to Pay NFC requires a physical NFC-capable Android device.`
- **Instruction 2 — Taxi Driver:**
  - **Name:** `Taxi Driver Demo`
  - **Username / Email:** `ramtaxi@gmail.com`
  - **Password:** `Ram@123`
  - **Instructions:** `Sign in on the login screen with these credentials to test the Taxi Driver shift workflow, payment collection, and transaction history.`

### B. Ads
- **Does your app contain ads?** `No`

### C. Target Audience & Content Rating
- **Target Age Group:** `18 and over`
- **Appeals to children:** `No`
- **Content Rating (IARC):** Utility / Productivity / Business app (no violence, gambling, UGC social feeds, or mature content)
- **News / COVID-19 / Government / Health App:** `No`

### D. Financial Features Declaration
- **App provides financial features:** `Yes` → Payment processing / Point of Sale (POS) / Merchant payment acceptance (powered by Stripe Terminal)

### E. Data Safety
- **Collects or shares required user data:** `Yes`
- **Encrypted in transit (HTTPS):** `Yes`
- **Data Types Collected:**
  - **Personal Info:** Name, Email address, Phone number, Address *(App functionality & Account management)*
  - **Financial Info:** Payment info / Purchase & transaction history *(App functionality — card processing handled via Stripe Terminal SDK)*
  - **Location:** Approximate & Precise location *(Required by Stripe Terminal SDK for Tap to Pay compliance & fraud prevention)*
  - **Device or other IDs:** Device model, OS version, Device ID *(App functionality, Security & Fraud prevention)*
  - **Photos & Videos (Optional):** Profile / business logo images if uploaded by user *(App functionality)*
- **Data shared with third parties:** Stripe (Stripe Terminal SDK) for payment processing & fraud prevention.
- **Account / Data deletion URL:** `https://sepay.stageserv.in/privacy` *(note: accounts are provisioned by business/fleet admins; users can request deletion via `setaxibrokers@gmail.com`)*

---

## 6. Release Notes (v1.0)

```text
Initial release of SE Pay (v1.0):
• Accept contactless Tap to Pay payments on NFC-enabled Android devices
• Record card and cash transactions with real-time transaction history
• Share and export digital receipts
• Manage shifts, employees, and taxi fleet drivers
```
