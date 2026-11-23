# Tap to Pay on iPhone (TTPOI) Production Entitlement Submission Package

This guide covers everything required to lift the **Development Distribution Restriction** and secure the **Production Entitlement** for Tap to Pay on iPhone for **SE Pay** (`com.syscentric.taptopay`) under Apple Case-ID: **23629363**.

---

## 1. Files in this Package

| File | Purpose | Location |
|---|---|---|
| **Checklist (Excel)** | Completed Apple Checklist 1.8 (Tabs 1 & 2) ready to export as PDF / Numbers | [SE_Pay_Tap_to_Pay_on_iPhone_Checklist_1_8.xlsx](file:///d:/syscentric/TapToPay/docs/SE_Pay_Tap_to_Pay_on_iPhone_Checklist_1_8.xlsx) |
| **Original Numbers** | The raw template provided by Apple | `App_Review_Requirements_Checklist_1_8.numbers` |
| **Submission Guide** | Complete submission text & instructions (this file) | [TTPOI_PRODUCTION_SUBMISSION_GUIDE.md](file:///d:/syscentric/TapToPay/docs/TTPOI_PRODUCTION_SUBMISSION_GUIDE.md) |

---

## 2. Tab 1: App Details (Completed)

| Field | Value | Notes |
|---|---|---|
| **Team ID** | `[YOUR 10-CHAR TEAM ID]` | Find at [developer.apple.com/account](https://developer.apple.com/account) under Membership details |
| **App Name** | `SE Pay` | App Name on App Store Connect |
| **PSP Name** | `Stripe (Stripe Terminal SDK / Tap to Pay on iPhone)` | Certified PSP partner |
| **Date** | `20-Nov-2026` | Current submission date |
| **Version** | `1.0` | Initial production version |
| **Existing or New app** | `New` | First-time submission |
| **Distribution type** | `Public` | Public App Store distribution |
| **Number of Devices** | `0-99` | Initial rollout (scalable for taxi fleet) |
| **Bundle ID** | `com.syscentric.taptopay` | iOS bundle identifier |
| **Case-ID** | `23629363` | Apple Entitlements case identifier |
| **Target Country / Region** | `Australia (AU)` | Primary market |

---

## 3. Tab 2: Checklist Summary (All Items Passing)

### A. Platform & Hardware
- **Supported iPhones:** iPhone XS and later (A12 Bionic+), running iOS 16.4+ / iOS 17+.
- **OS Version Handling:** `PaymentCardReaderError.osVersionNotSupported` handled with user-friendly update prompt.

### B. Onboarding & Permissions
- **Digital Onboarding:** Completed on iPhone in < 2 minutes via merchant login & immediate Stripe Terminal connection.
- **Admin Terms Acceptance:** Only merchant/business owners have privileges to accept Terms & Conditions.
- **Reader Preparation:** Progress indicator displayed while reader prepares and warms up.

### C. Enabling & Discoverability
- **Introduction:** Tap to Pay on iPhone banner and card featured on merchant dashboard.
- **Access Outside Checkout:** Available anytime via Profile / Terminal Settings.

### D. Checkout Flow
- **Button Placement:** Tap to Pay / Card is the primary default payment option at the top of the keypad screen.
- **Iconography & Phrasing:** Uses standard contactless SF Symbol (`wave.3.right.circle`) and approved copy `"Tap to Pay on iPhone"`.
- **Pre-warming:** Reader initialization triggered upon shift start / app foregrounding.
- **Transition:** Clean transition to processing screen during payment intent execution.
- **Outcome:** Explicit Approved (Success screen with checkmark) or Declined screens.

### E. Receipts & Supported Schemes
- **Receipts:** Digital receipts available via SMS, Email, QR code, and iOS Share sheet (PDF export).
- **Supported Schemes in Australia:** Visa, Mastercard, American Express, and contactless eftpos via Stripe Terminal.
- **Fallbacks:** Manual Card Entry and Cash payment options available.
- **Refunds:** Referenced refunds supported in transaction history for authorized merchants.

---

## 4. The 3 Required Video Recordings

Record these on a physical iPhone (iPhone XS or newer):

### Video 1: `SE_Pay_New_User_Flow.mp4`
1. Open SE Pay freshly installed or signed out.
2. Sign in with Merchant Owner credentials (`laraShop@gmail.com` / `Lara@123`).
3. Show permission prompts (Location / Bluetooth).
4. Show the dashboard appearing with the active shift and Tap to Pay readiness indicator.

### Video 2: `SE_Pay_Existing_User_Flow.mp4`
1. Launch the app as an existing logged-in user.
2. Show the shift dashboard, active shift revenue, and terminal status in Profile/Settings.
3. Tap **CREATE SALE** to demonstrate how an active merchant accesses checkout daily.

### Video 3: `SE_Pay_Checkout_Flow.mp4` *(Best recorded with a second phone)*
1. Enter an amount (e.g. `$10.00`) on the SE Pay keypad.
2. Select **Card / Tap to Pay**.
3. Show Apple's native **Tap to Pay on iPhone sheet** popping up with the contactless symbol and `"Hold Here to Pay"`.
4. Hold a physical payment card or phone against the top edge of the iPhone.
5. Show the Apple checkmark appearing, the sound/haptic feedback, and the app transitioning to the **SE Pay Payment Success** and **Digital Receipt** screen.

---

## 5. Submission Steps

1. Open [SE_Pay_Tap_to_Pay_on_iPhone_Checklist_1_8.xlsx](file:///d:/syscentric/TapToPay/docs/SE_Pay_Tap_to_Pay_on_iPhone_Checklist_1_8.xlsx) in Excel or Apple Numbers.
2. Add your **Team ID** on the `App Details` tab (Row 7, Cell B7).
3. Export / Save as **`SE_Pay_TTPOI_Checklist.pdf`** (or `.numbers`).
4. Upload all 4 files to Apple's Box Uploader:
   👉 [https://apple.ent.box.com/f/c4a9f946db9a44ddbc196be1c3ef8924](https://apple.ent.box.com/f/c4a9f946db9a44ddbc196be1c3ef8924)
   - `SE_Pay_TTPOI_Checklist.pdf`
   - `SE_Pay_New_User_Flow.mp4`
   - `SE_Pay_Existing_User_Flow.mp4`
   - `SE_Pay_Checkout_Flow.mp4`
5. Reply to `ttpoientitlements@apple.com` using the template below.

---

## 6. Email Reply Template

```text
Subject: Re: [SOUTH EASTERN TAXI BROKERS PTY. LTD.] Request Access to the ProximityReader APIs; Case-ID: 23629363

Hello TTPOI Entitlements Team,

We have completed the implementation of Tap to Pay on iPhone in our app "SE Pay" (Bundle ID: com.syscentric.taptopay) using the Stripe Terminal SDK and verified full end-to-end contactless payment processing.

We have reviewed the Tap to Pay on iPhone App Requirements and completed the checklist. The requested review assets have been uploaded to the File Uploader:

1. App Review Requirements Checklist: SE_Pay_TTPOI_Checklist.pdf
2. New User Flow video: SE_Pay_New_User_Flow.mp4
3. Existing User Flow video: SE_Pay_Existing_User_Flow.mp4
4. Checkout Flow video: SE_Pay_Checkout_Flow.mp4

Please review our submission and grant the Production Entitlement for Tap to Pay on iPhone.

Case-ID: 23629363

Thank you,
S E Taxi Brokers Pty Ltd
setaxibrokers@gmail.com
```
