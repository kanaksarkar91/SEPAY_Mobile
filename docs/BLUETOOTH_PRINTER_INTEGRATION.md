# Bluetooth Thermal Printer Integration Guide

## Overview
This document contains the complete technical architecture, reverse-engineered vendor mechanics, offline cloud authentication bypass, and troubleshooting guide for the **Tiny Printer Bluetooth Thermal Printer** integration in SE Pay.

---

## 1. Supported Hardware
* **Primary Target:** `X5h-2152` (Cat / Mini Thermal Receipt Printer, 58mm paper width)
* **Print Resolution:** 200 DPI (384 pixels printable raster line width)
* **Communication Protocol:** Bluetooth Low Energy (BLE) GATT (Transport LE)
* **Also Compatible with:** `X5`, `X16`, `GB01`, `GB02`, `GT01`, `GT02`, `GT08`, `LY01`, `LY02`, `58P5`, `S101`, and related Chinese OEM mini thermal printer families.

---

## 2. Architecture & Components

```
┌────────────────────────────────────────────────────────┐
│               React Native / Expo UI                   │
│             (src/app/printer-demo.tsx)                 │
└──────────────────────────┬─────────────────────────────┘
                           │ TypeScript Calls & Listeners
┌──────────────────────────▼─────────────────────────────┐
│              TinyPrinter Expo Module                   │
│            (modules/tiny-printer/index.ts)             │
└──────────────────────────┬─────────────────────────────┘
                           │ JNI / Expo Kotlin DSL
┌──────────────────────────▼─────────────────────────────┐
│                 TinyPrinterModule.kt                   │
│   (modules/tiny-printer/android/.../TinyPrinterModule) │
│                                                        │
│  • Dual BLE Scanner (Vendor + Low-Latency Native)      │
│  • Offline SPUtils SDK Bypass Injector                 │
│  • 384px Monochrome Canvas Receipt Generator           │
│  • Watchdog Timer & Settling Delay Manager             │
└────────────┬─────────────────────────────┬─────────────┘
             │ Pre-Populates Auth          │ Calls SDK
┌────────────▼─────────────┐ ┌─────────────▼─────────────┐
│    com.blankj SPUtils    │ │   Vendor SDK JAR Libraries │
│  (SharedPreferences Map) │ │ (bleLib1, bleLib2, bleLib3)│
└──────────────────────────┘ └─────────────┬─────────────┘
                                           │ Binds Service
                             ┌─────────────▼─────────────┐
                             │    BluetoothLeService     │
                             │ (cn.com.heaton.blelibrary)│
                             └─────────────┬─────────────┘
                                           │ connectGatt (LE)
                             ┌─────────────▼─────────────┐
                             │    X5h-2152 Hardware      │
                             └───────────────────────────┘
```

---

## 3. Reverse-Engineered SDK Mechanics & Critical Fixes

### A. The AndroidManifest Service Requirement
* **Class:** `cn.com.heaton.blelibrary.ble.BluetoothLeService extends android.app.Service`
* **Mechanism:** When `bleOrderUtils.init()` runs, the library executes:
  ```java
  context.bindService(new Intent(context, BluetoothLeService.class), mServiceConnection, Context.BIND_AUTO_CREATE);
  ```
* **Failure Mode:** If `BluetoothLeService` is **not** registered in `AndroidManifest.xml`, Android silently refuses to bind the service. `Ble.getInstance().getBleService()` remains `null`. When `connect()` is called, it checks:
  ```java
  BluetoothLeService service = Ble.getInstance().getBleService();
  if (service == null) return false; // SILENTLY ABORTS
  ```
* **Required Declaration:** Both `modules/tiny-printer/android/src/main/AndroidManifest.xml` and `android/app/src/main/AndroidManifest.xml` must include:
  ```xml
  <service
      android:name="cn.com.heaton.blelibrary.ble.BluetoothLeService"
      android:exported="false" />
  ```

### B. Offline Cloud Authentication Lock Bypass
* **Mechanism:** The vendor SDK’s `init()` attempts an HTTP call to a hardcoded Chinese cloud server:
  `http://120.27.29.129:6000/devInfo?act=checkSdk`
  Outside of China, this connection fails or times out. When unauthorized, `DeviceUtils.checkValidModel()` and `DeviceUtils.scanShow()` return `false`, causing `blueConnect()` and `printImage()` to silently drop all requests or throw `"Device not activated"`.
* **The Bypass:** We pre-populate `SPUtils` (SharedPreferences) locally in `populateSdkBypass()` and `dynamicallyAuthorizeDevice()` with:
  1. `Code.bleUserId` (`"bleSdkUserId"`) $\rightarrow$ `"QDX"`
  2. `Code.TAG + Code.devInfo` (`"frogToSeadevInfo"`) $\rightarrow$ Valid serialized `PrinterModel` JSON with 384px print size, 200 DPI.
  3. `Code.USERRIGHT + model` (`"userRight" + model`) $\rightarrow$ `true`
  4. `Code.DEVTYPELIST + userId + model` (`"devTypeList" + userId + model`) $\rightarrow$ `true`
  5. `Code.CANPRINT` (`"canPrint"`), `Code.active` (`"active"`), `Code.COMPRESS` (`"compress"`) $\rightarrow$ `true`
  6. `Code.DEVICETYPE` (`"BleSdkdeviceType"`) $\rightarrow$ device name
  7. `Code.DEF_DEVICE_ADDRESS` (`"BleSdkdefDeviceAddress"`) $\rightarrow$ device MAC address

### C. Model Prefix Ordering Rule
* In `com.ble.order.getPrintMode`, the SDK iterates through configured models and tests:
  ```java
  name.startsWith(dataBean.getModelNo())
  ```
* If `"X5"` is placed before `"X5h"` in the models list, `"X5h-2152".startsWith("X5")` evaluates to `true`, erroneously selecting the default `"X5"` profile instead of the specific `"X5h"` profile.
* **Rule:** Specific / longer prefixes must **always** precede shorter prefixes:
  ```kotlin
  listOf("X5h", "X5", "X16", "X6", "X8", "X", ...)
  ```

### D. Dual BLE Scanner & Radio Settling
* The scanner runs both vendor `scanDevice()` and Android's native `BluetoothLeScanner` configured with `ScanSettings.SCAN_MODE_LOW_LATENCY`.
* When initiating a connection, `stopScan()` must be called first, followed by a **250ms settling pause** (`Thread.sleep(250)`) before calling `bleConnect()`. This prevents the phone's Bluetooth controller from choking while transitioning out of high-duty scan mode.
* A **15-second watchdog timer** guards the connection promise so the UI never hangs if the printer is powered off mid-connection.

---

## 4. Module API Reference

### Methods (`TinyPrinter`)
```typescript
import TinyPrinter from '@/modules/tiny-printer';

// Initialize the vendor SDK with offline authorization bypass
await TinyPrinter.initSdk('QDX');

// Start high-priority BLE scan
await TinyPrinter.startScan();

// Stop active BLE scan
TinyPrinter.stopScan();

// Connect to a discovered printer
await TinyPrinter.connect(address, name);

// Disconnect from the active printer
TinyPrinter.disconnect(address);

// Mechanically feed thermal paper
TinyPrinter.feedPaper();

// Print receipt bitmap from structured data
await TinyPrinter.printReceipt(receiptData, address, name, density);

// Print custom Base64 image
await TinyPrinter.printImageBase64(base64Png, address, name, density);

// Check if Bluetooth is turned on
const enabled: boolean = TinyPrinter.isBleEnabled();

// Request OS prompt to turn on Bluetooth
TinyPrinter.enableBluetooth();

// Open Location Settings (required for BLE on Android <= 11)
TinyPrinter.openLocationSettings();
```

### Event Listeners
```typescript
// Discovered printer in scan
TinyPrinter.addDeviceDiscoveredListener((event: DeviceDiscoveredEvent) => {
  // event.name, event.address, event.isMatching
});

// Connection state changed
TinyPrinter.addConnectionChangeListener((event: ConnectionChangeEvent) => {
  // event.status: 'connected' | 'disconnected' | 'failed' | 'timeout'
});

// Print progress & status
TinyPrinter.addPrintStatusListener((event: PrintStatusEvent) => {
  // event.status: 'progress' | 'success' | 'failed'
  // event.progress: 0.0 - 1.0
});
```

---

## 5. Building the Standalone APK

Because this module uses custom native Android libraries (`.jar` and `.so`), it cannot run in Expo Go. It must be built as a standalone APK:

```powershell
# In the android directory:
cd android
./gradlew assembleRelease

# Output APK path:
# android/app/build/outputs/apk/release/app-release.apk
```

### Verify APK Signature:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --verbose android/app/build/outputs/apk/release/app-release.apk
```
Must report: `Verifies` and `Verified using v2 scheme: true`.

---

## 6. ProGuard & R8 Configuration
The following rules in `android/app/proguard-rules.pro` ensure the vendor SDK is not stripped or obfuscated during release builds:
```proguard
-keep class com.ble.** { *; }
-keep class cn.com.heaton.blelibrary.** { *; }
-keep class org.opencv.** { *; }
-keep class com.blankj.utilcode.** { *; }
-keep class com.lzy.okgo.** { *; }
```

---

## 7. iOS Native Implementation (`TinyPrinterModule.swift`)

### A. CoreBluetooth Architecture
Unlike Android which uses vendor `.jar` binaries, iOS utilizes a pure Swift CoreBluetooth implementation adhering strictly to the thermal printer hardware's GATT profile and packet protocol.

* **Primary Service UUIDs:** `0000AE30-0000-1000-8000-00805F9B34FB`, fallback `E7810A71-73AE-499D-8C15-FAA9AEF0C3F2`, `49535343-FE7D-4AE5-8FA9-9FAFD205E455`.
* **Write Characteristic:** `AE01`, `FF02`, `FFE1`, or `AB01` (supports `.withoutResponse`).
* **Notify Characteristic:** `AE02`, `FF02`, or `FFE1` (for device status & battery reporting).

### B. Connection Lifecycle & Zombie Prevention
1. **Peripheral Retrieval:**
   Peripheral lookup checks `discoveredPeripherals` cache and `centralManager.retrievePeripherals(withIdentifiers: [UUID])`.
2. **Watchdog & Cancellation:**
   A 15-second watchdog timer guards manual connections. If a connection times out or fails:
   `centralManager.cancelPeripheralConnection(peripheral)` is immediately invoked so iOS does not leave a pending connection queued in the CoreBluetooth background daemon.
3. **Disconnection Cleanup:**
   `disconnect(address)` invalidates any active connection watchdog timer and cancels any pending connection on the central manager.
4. **Characteristics Discovery:**
   `onConnectionChange` with `"status": "connected"` is broadcast whenever the write characteristic is discovered and ready, regardless of whether a promise is actively awaiting.

---

## 8. Reverse-Engineered Thermal Protocol & Opcode Specification

Every raster image print job follows an exact 8-stage byte packet sequence matching the vendor protocol:

```
[0xA4 Blackening] -> [0xAF Pulse Energy] -> [0xA6 Lattice Init] -> [0xBE Image Mode] -> [0xBD Motor Speed] -> [0xA2 Raster Rows x N] -> [0xA6 Lattice Finish] -> [0xA1 Feed Paper]
```

### Detailed Opcode Table:

| Opcode | Purpose | Packet Structure | Payload Details |
|---|---|---|---|
| **`0xA4`** | Blackening / Density | `51 78 A4 00 01 00 <densityByte> <crc8> FF` | Light: `0x32` (CRC `0x9E`)<br>Normal: `0x33` (CRC `0x99`)<br>Dark: `0x35` (CRC `0x8B`) |
| **`0xAF`** | Thermal Pulse Energy ($\mu s$) | `51 78 AF 00 02 00 <low> <high> <crc8> FF` | Light: `5000 µs` (`0x88, 0x13`, CRC `0x67`)<br>Normal: `6500 µs` (`0x64, 0x19`, CRC `0xEE`)<br>Dark: `7500 µs` (`0x4C, 0x1D`, CRC `0xF4`) |
| **`0xA6`** | Matrix Calibration Init | `51 78 A6 00 0B 00 AA 55 17 38 44 5F 5F 5F 44 38 2C A1 FF` | Configures printhead strobe matrix |
| **`0xBE`** | Print Mode (Image) | `51 78 BE 00 01 00 00 00 FF` | Selects monochrome raster graphics engine |
| **`0xBD`** | Motor Feed Speed | `51 78 BD 00 01 00 <speedByte> <crc8> FF` | Fast Speed: `0x0A` (10) (CRC `0x36`). **Critical:** Without `0xBD`, printer firmware defaults to slowest safe fallback crawl (20–30s). |
| **`0xA2`** | Monochrome Raster Row | `51 78 A2 00 30 00 [48 bytes payload] <crc8> FF` | 384 pixels / 8 = 48 bytes per line. 1 bit per pixel (`1` = burn black dot, `0` = paper white). |
| **`0xA6`** | Matrix Calibration Finish | `51 78 A6 00 0B 00 AA 55 17 00 00 00 00 00 00 00 17 11 FF` | Closes printhead strobe matrix |
| **`0xA1`** | Paper Feed | `51 78 A1 00 02 00 <lines> 00 <crc8> FF` | Default 96 lines (`0x60, 0x00`, CRC `0xF5`) feeds paper to tear bar |

### Bit Mapping & Orientation Rule:
* **Pixels to Byte:** `byteIdx = x / 8`, `bitIdx = x % 8`. Dot is black if luminance $< 160.0$.
* **Row Scan:** Scan lines from top ($y = 0$) to bottom ($y = H - 1$) so header prints first and footer prints last.
* **Streaming Pacing:** Pack up to 168 bytes (3 rows) per BLE write packet with a `1ms` pacing sleep matching Android vendor `setDelay(1L)`.

---

## 9. Auto-Connect & Human Error Resilience Architecture

### Failure Modes & Human Scenarios Handled:

#### 1. User taps "Print Digital Receipt" when printer is OFF or unlinked:
* **Mechanism:** `printerService.autoConnect(timeoutMs = 3500)` runs with a fast 3.5s timeout instead of the standard 15s watchdog.
* **Behavior:** If the printer does not respond within 3.5s, the attempt immediately aborts, rolls back `connectionStatus` to `'disconnected'`, cancels the native background connection, and presents the user with:
  *"Printer Not Connected: No thermal printer is connected. Would you like to configure your printer in Printer Settings?"* with **[Open Settings]** and **[Cancel]**.

#### 2. User taps "Cancel" or leaves modal while connecting/printing:
* **Mechanism:** In `ReceiptShareModal.tsx`, `handleModalClose()` flags `isCancelledRef.current = true`, resets `isSharing = false`, and clears `sharingFormat = null`.
* **Behavior:** The active async capture/print job is cleanly abandoned. No stale state or zombie promise remains.

#### 3. User connects printer from Settings and returns to Receipt:
* **Mechanism:** The modal auto-trigger `useEffect` is no longer blocked by stale `isSharing` flags.
* **Behavior:** When returning from Settings and reopening the modal, the clean state immediately triggers `handlePrintThermalReceipt()`. The printer prints the receipt in **~2 seconds**.

