import Foundation
import CoreBluetooth
import UIKit
import ExpoModulesCore

private final class BleDelegateProxy: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  weak var owner: TinyPrinterModule?

  init(owner: TinyPrinterModule) {
    self.owner = owner
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    owner?.centralManagerDidUpdateState(central)
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    owner?.centralManager(central, didDiscover: peripheral, advertisementData: advertisementData, rssi: RSSI)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    owner?.centralManager(central, didConnect: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    owner?.centralManager(central, didFailToConnect: peripheral, error: error)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    owner?.centralManager(central, didDisconnectPeripheral: peripheral, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    owner?.peripheral(peripheral, didDiscoverServices: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    owner?.peripheral(peripheral, didDiscoverCharacteristicsFor: service, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    owner?.peripheral(peripheral, didUpdateValueFor: characteristic, error: error)
  }
}

public class TinyPrinterModule: Module {
  private lazy var bleDelegate = BleDelegateProxy(owner: self)
  private var centralManager: CBCentralManager?
  private var discoveredPeripherals = [String: CBPeripheral]()
  private var connectedPeripheral: CBPeripheral?
  private var writeCharacteristic: CBCharacteristic?
  private var notifyCharacteristic: CBCharacteristic?

  private var connectPromise: Promise?
  private var connectWatchdogTimer: Timer?
  private var printQueue = DispatchQueue(label: "com.sepay.tinyprinter.print", qos: .userInitiated)

  private var lastBatteryLevel: Int = -1
  private var lastDevStatus: Int = -1

  // CRC-8 Lookup Table for Mini 58mm Thermal Printers (Dallas/Maxim polynomial)
  private static let checksumTable: [UInt8] = [
    0x00, 0x07, 0x0E, 0x09, 0x1C, 0x1B, 0x12, 0x15, 0x38, 0x3F, 0x36, 0x31, 0x24, 0x23, 0x2A, 0x2D,
    0x70, 0x77, 0x7E, 0x79, 0x6C, 0x6B, 0x62, 0x65, 0x48, 0x4F, 0x46, 0x41, 0x54, 0x53, 0x5A, 0x5D,
    0xE0, 0xE7, 0xEE, 0xE9, 0xFC, 0xFB, 0xF2, 0xF5, 0xD8, 0xDF, 0xD6, 0xD1, 0xC4, 0xC3, 0xCA, 0xCD,
    0x90, 0x97, 0x9E, 0x99, 0x8C, 0x8B, 0x82, 0x85, 0xA8, 0xAF, 0xA6, 0xA1, 0xB4, 0xB3, 0xBA, 0xBD,
    0xC7, 0xC0, 0xC9, 0xCE, 0xDB, 0xDC, 0xD5, 0xD2, 0xFF, 0xF8, 0xF1, 0xF6, 0xE3, 0xE4, 0xED, 0xEA,
    0xB7, 0xB0, 0xB9, 0xBE, 0xAB, 0xAC, 0xA5, 0xA2, 0x8F, 0x88, 0x81, 0x86, 0x93, 0x94, 0x9D, 0x9A,
    0x27, 0x20, 0x29, 0x2E, 0x3B, 0x3C, 0x35, 0x32, 0x1F, 0x18, 0x11, 0x16, 0x03, 0x04, 0x0D, 0x0A,
    0x57, 0x50, 0x59, 0x5E, 0x4B, 0x4C, 0x45, 0x42, 0x6F, 0x68, 0x61, 0x66, 0x73, 0x74, 0x7D, 0x7A,
    0x89, 0x8E, 0x87, 0x80, 0x95, 0x92, 0x9B, 0x9C, 0xB1, 0xB6, 0xBF, 0xB8, 0xAD, 0xAA, 0xA3, 0xA4,
    0xF9, 0xFE, 0xF7, 0xF0, 0xE5, 0xE2, 0xEB, 0xEC, 0xC1, 0xC6, 0xCF, 0xC8, 0xDD, 0xDA, 0xD3, 0xD4,
    0x69, 0x6E, 0x67, 0x60, 0x75, 0x72, 0x7B, 0x7C, 0x51, 0x56, 0x5F, 0x58, 0x4D, 0x4A, 0x43, 0x44,
    0x19, 0x1E, 0x17, 0x10, 0x05, 0x02, 0x0B, 0x0C, 0x21, 0x26, 0x2F, 0x28, 0x3D, 0x3A, 0x33, 0x34,
    0x4E, 0x49, 0x40, 0x47, 0x52, 0x55, 0x5C, 0x5B, 0x76, 0x71, 0x78, 0x7F, 0x6A, 0x6D, 0x64, 0x63,
    0x3E, 0x39, 0x30, 0x37, 0x22, 0x25, 0x2C, 0x2B, 0x06, 0x01, 0x08, 0x0F, 0x1A, 0x1D, 0x14, 0x13,
    0xAE, 0xA9, 0xA0, 0xA7, 0xB2, 0xB5, 0xBC, 0xBB, 0x96, 0x91, 0x98, 0x9F, 0x8A, 0x8D, 0x84, 0x83,
    0xDE, 0xD9, 0xD0, 0xD7, 0xC2, 0xC5, 0xCC, 0xCB, 0xE6, 0xE1, 0xE8, 0xEF, 0xFA, 0xFD, 0xF4, 0xF3
  ]

  private static func calcCrc8(_ bytes: [UInt8]) -> UInt8 {
    var crc: UInt8 = 0
    for b in bytes {
      let idx = Int(crc ^ b)
      crc = checksumTable[idx]
    }
    return crc
  }

  public func definition() -> ModuleDefinition {
    Name("TinyPrinter")

    Events(
      "onDeviceDiscovered",
      "onConnectionChange",
      "onPrintStatus",
      "onPrinterStatus"
    )

    OnCreate {
      if self.centralManager == nil {
        self.centralManager = CBCentralManager(delegate: self.bleDelegate, queue: .main)
      }
    }

    AsyncFunction("initSdk") { (userId: String, promise: Promise) in
      if self.centralManager == nil {
        self.centralManager = CBCentralManager(delegate: self.bleDelegate, queue: .main)
      }
      promise.resolve([
        "success": true,
        "userId": userId.isEmpty ? "QDX" : userId,
        "checkDevice": true,
        "checkCache": true
      ])
    }

    Function("checkDevice") { (_: String) -> Bool in
      return true
    }

    Function("checkCache") { () -> Bool in
      return true
    }

    Function("getPrinterPixel") { (_: String) -> Int in
      return 384
    }

    Function("isBleEnabled") { () -> Bool in
      return self.centralManager?.state == .poweredOn
    }

    Function("enableBluetooth") { () -> Bool in
      // iOS manages Bluetooth power state via Control Center / Settings
      if let url = URL(string: UIApplication.openSettingsURLString) {
        DispatchQueue.main.async {
          UIApplication.shared.open(url)
        }
        return true
      }
      return false
    }

    Function("openLocationSettings") { () -> Bool in
      if let url = URL(string: UIApplication.openSettingsURLString) {
        DispatchQueue.main.async {
          UIApplication.shared.open(url)
        }
        return true
      }
      return false
    }

    AsyncFunction("startScan") { (promise: Promise) in
      guard let central = self.centralManager else {
        self.centralManager = CBCentralManager(delegate: self.bleDelegate, queue: .main)
        promise.resolve(false)
        return
      }

      guard central.state == .poweredOn else {
        promise.reject("ERR_BLE_DISABLED", "Bluetooth is turned off")
        return
      }

      self.discoveredPeripherals.removeAll()
      central.scanForPeripherals(
        withServices: nil,
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
      )
      promise.resolve(true)
    }

    Function("stopScan") { () -> Bool in
      self.centralManager?.stopScan()
      return true
    }

    AsyncFunction("connect") { (address: String, name: String, promise: Promise) in
      guard let central = self.centralManager else {
        promise.reject("ERR_BLE", "Central manager not initialized")
        return
      }

      central.stopScan()

      // Find peripheral by UUID identifier or discovered list
      var peripheralToConnect: CBPeripheral? = self.discoveredPeripherals[address]
      if peripheralToConnect == nil, let uuid = UUID(uuidString: address) {
        let known = central.retrievePeripherals(withIdentifiers: [uuid])
        peripheralToConnect = known.first
      }

      guard let peripheral = peripheralToConnect else {
        promise.reject("ERR_DEVICE_NOT_FOUND", "Thermal printer peripheral not found for address: \(address)")
        return
      }

      self.connectPromise = promise
      self.connectWatchdogTimer?.invalidate()
      self.connectWatchdogTimer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: false) { [weak self] _ in
        guard let self = self, let p = self.connectPromise else { return }
        self.connectPromise = nil
        self.sendEvent("onConnectionChange", [
          "status": "timeout",
          "address": address,
          "name": name
        ])
        p.reject("ERR_CONNECT_TIMEOUT", "Connection to printer timed out")
      }

      central.connect(peripheral, options: nil)
    }

    Function("disconnect") { (address: String) -> Bool in
      if let peripheral = self.connectedPeripheral {
        self.centralManager?.cancelPeripheralConnection(peripheral)
      }
      self.connectedPeripheral = nil
      self.writeCharacteristic = nil
      self.notifyCharacteristic = nil
      self.lastBatteryLevel = -1
      self.lastDevStatus = -1
      self.sendEvent("onPrinterStatus", [
        "status": -1,
        "batteryLevel": -1,
        "hasPaper": false,
        "address": address
      ])
      self.sendEvent("onConnectionChange", [
        "status": "disconnected",
        "address": address
      ])
      return true
    }

    Function("feedPaper") { () -> Bool in
      return self.sendPaperFeedCommand(lines: 48)
    }

    AsyncFunction("printReceipt") { (receiptData: [String: Any], address: String, name: String, density: Int, promise: Promise) in
      guard let peripheral = self.connectedPeripheral, let writeChar = self.writeCharacteristic else {
        promise.reject("ERR_NOT_CONNECTED", "No thermal printer connected")
        return
      }

      let image = self.renderReceiptImage(data: receiptData, width: 384)
      self.printImageAsync(image: image, peripheral: peripheral, writeChar: writeChar, density: density, promise: promise)
    }

    AsyncFunction("printImageBase64") { (base64Data: String, address: String, name: String, density: Int, promise: Promise) in
      guard let peripheral = self.connectedPeripheral, let writeChar = self.writeCharacteristic else {
        promise.reject("ERR_NOT_CONNECTED", "No thermal printer connected")
        return
      }

      let cleanBase64 = base64Data.contains(",") ? String(base64Data.split(separator: ",")[1]) : base64Data
      guard let data = Data(base64Encoded: cleanBase64), let image = UIImage(data: data) else {
        promise.reject("ERR_DECODE_IMAGE", "Could not decode receipt image from base64")
        return
      }

      let scaledImage = self.scaleImageToWidth(image: image, targetWidth: 384)
      self.printImageAsync(image: scaledImage, peripheral: peripheral, writeChar: writeChar, density: density, promise: promise)
    }

    Function("requestDeviceStatus") { (_: String?) -> Bool in
      return self.requestDeviceStatusInternal()
    }

    Function("getBatteryLevel") { () -> Int in
      return self.lastBatteryLevel
    }

    Function("getPrinterStatus") { () -> [String: Any] in
      return [
        "batteryLevel": self.lastBatteryLevel,
        "status": self.lastDevStatus,
        "hasPaper": self.lastDevStatus != 1 && self.lastDevStatus >= 0,
        "address": self.connectedPeripheral?.identifier.uuidString ?? ""
      ]
    }
  }

  // MARK: - CBCentralManagerDelegate

  fileprivate func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state != .poweredOn {
      if connectedPeripheral != nil {
        connectedPeripheral = nil
        writeCharacteristic = nil
        notifyCharacteristic = nil
        sendEvent("onConnectionChange", ["status": "disconnected"])
      }
    }
  }

  fileprivate func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
    if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return
    }

    let address = peripheral.identifier.uuidString
    discoveredPeripherals[address] = peripheral

    let lowerName = name.lowercased()
    let isMatch = lowerName.hasPrefix("x") ||
                  lowerName.contains("print") ||
                  lowerName.contains("thermal") ||
                  lowerName.contains("receipt") ||
                  lowerName.contains("pos") ||
                  lowerName.contains("58") ||
                  lowerName.contains("audio") ||
                  lowerName.contains("walk") ||
                  lowerName.contains("cat")

    sendEvent("onDeviceDiscovered", [
      "name": name,
      "address": address,
      "isMatching": isMatch
    ])
  }

  fileprivate func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    connectedPeripheral = peripheral
    peripheral.delegate = bleDelegate
    peripheral.discoverServices(nil)
  }

  fileprivate func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    connectWatchdogTimer?.invalidate()
    connectWatchdogTimer = nil
    if let p = connectPromise {
      connectPromise = nil
      p.reject("ERR_CONNECT_FAILED", error?.localizedDescription ?? "Failed to connect to printer")
    }
    sendEvent("onConnectionChange", [
      "status": "failed",
      "address": peripheral.identifier.uuidString
    ])
  }

  fileprivate func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    connectedPeripheral = nil
    writeCharacteristic = nil
    notifyCharacteristic = nil
    lastBatteryLevel = -1
    lastDevStatus = -1
    sendEvent("onPrinterStatus", [
      "status": -1,
      "batteryLevel": -1,
      "hasPaper": false,
      "address": peripheral.identifier.uuidString
    ])
    sendEvent("onConnectionChange", [
      "status": "disconnected",
      "address": peripheral.identifier.uuidString
    ])
  }

  // MARK: - CBPeripheralDelegate

  fileprivate func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil, let services = peripheral.services else { return }
    for service in services {
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard error == nil, let characteristics = service.characteristics else { return }

    for characteristic in characteristics {
      let uuidStr = characteristic.uuid.uuidString.uppercased()

      // Check write characteristics (AE01, FF02, FFE1, AB01 or general writable)
      if uuidStr.contains("AE01") || uuidStr.contains("FF02") || uuidStr.contains("FFE1") || uuidStr.contains("AB01") {
        self.writeCharacteristic = characteristic
      } else if self.writeCharacteristic == nil && (characteristic.properties.contains(.writeWithoutResponse) || characteristic.properties.contains(.write)) {
        self.writeCharacteristic = characteristic
      }

      // Check notify characteristics (AE02, FF02, FFE1, AE01 or general notifiable)
      if uuidStr.contains("AE02") || uuidStr.contains("FF02") || uuidStr.contains("FFE1") || uuidStr.contains("AE01") {
        if characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) {
          self.notifyCharacteristic = characteristic
          peripheral.setNotifyValue(true, for: characteristic)
        }
      }
    }

    if writeCharacteristic != nil && connectPromise != nil {
      connectWatchdogTimer?.invalidate()
      connectWatchdogTimer = nil
      let p = connectPromise
      connectPromise = nil

      let address = peripheral.identifier.uuidString
      let name = peripheral.name ?? "Thermal Printer"
      sendEvent("onConnectionChange", [
        "status": "connected",
        "address": address,
        "name": name
      ])

      p?.resolve([
        "connected": true,
        "address": address,
        "name": name
      ])

      DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
        _ = self?.requestDeviceStatusInternal()
      }
    }
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard error == nil, let data = characteristic.value, data.count >= 8 else { return }

    // Mini 58mm protocol response packet: 0x51, 0x78 ...
    if data[0] == 0x51 && data[1] == 0x78 {
      let status = Int(data[6])
      let rawBattery = Int(data[7])

      let normalizedBattery: Int
      if rawBattery > 100 {
        normalizedBattery = min(100, max(0, rawBattery / 20))
      } else if rawBattery >= 0 {
        normalizedBattery = min(100, rawBattery)
      } else {
        normalizedBattery = -1
      }

      self.lastDevStatus = status
      self.lastBatteryLevel = normalizedBattery
      let hasPaper = status != 1 && status >= 0

      sendEvent("onPrinterStatus", [
        "status": status,
        "batteryLevel": normalizedBattery,
        "hasPaper": hasPaper,
        "address": peripheral.identifier.uuidString
      ])
    }
  }

  fileprivate func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    // BLE radio buffer drained and ready for next chunk
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    // Acknowledgment for write with response
  }

  // MARK: - Internal Commands & Printing

  private func requestDeviceStatusInternal() -> Bool {
    guard let peripheral = connectedPeripheral, let writeChar = writeCharacteristic else { return false }
    // getElectricQuantity: 51 78 BA 00 01 00 00 00 FF
    let batteryCmd: [UInt8] = [0x51, 0x78, 0xBA, 0x00, 0x01, 0x00, 0x00, 0x00, 0xFF]
    sendBleData(Data(batteryCmd), peripheral: peripheral, writeChar: writeChar)

    // getDevState: 51 78 A3 00 01 00 00 00 FF
    let stateCmd: [UInt8] = [0x51, 0x78, 0xA3, 0x00, 0x01, 0x00, 0x00, 0x00, 0xFF]
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
      self?.sendBleData(Data(stateCmd), peripheral: peripheral, writeChar: writeChar)
    }
    return true
  }

  private func sendPaperFeedCommand(lines: UInt8 = 48) -> Bool {
    guard let peripheral = connectedPeripheral, let writeChar = writeCharacteristic else { return false }
    // Feed packet: 51 78 A1 00 02 00 <lines> 00 <crc8> FF
    let payload: [UInt8] = [lines, 0x00]
    let crc = TinyPrinterModule.calcCrc8(payload)
    let packet: [UInt8] = [0x51, 0x78, 0xA1, 0x00, 0x02, 0x00, lines, 0x00, crc, 0xFF]
    sendBleData(Data(packet), peripheral: peripheral, writeChar: writeChar)
    return true
  }

  private func sendBleData(_ data: Data, peripheral: CBPeripheral, writeChar: CBCharacteristic) {
    let writeType: CBCharacteristicWriteType = writeChar.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
    peripheral.writeValue(data, for: writeChar, type: writeType)
  }

  private func printImageAsync(image: UIImage, peripheral: CBPeripheral, writeChar: CBCharacteristic, density: Int, promise: Promise) {
    printQueue.async { [weak self] in
      guard let self = self else { return }

      let targetWidth = 384
      guard let rasterRows = self.convertImageToRasterRows(image: image, width: targetWidth) else {
        promise.reject("ERR_RASTERIZE", "Failed to convert receipt image to monochrome raster")
        return
      }

      // Build the complete transmission payload matching Android vendor SDK (BleOrderUtils / PrintDataUtils)
      var streamBuffer = [UInt8]()
      streamBuffer.reserveCapacity(128 + rasterRows.count * 56)

      // 1. Send blackening / density command matching Android vendor SDK (0xA4)
      // Density values: 2 (light), 3 (normal), 5 (dark)
      let densityByte: UInt8 = (density == 2) ? 0x32 : ((density == 5) ? 0x35 : 0x33)
      let densityCrc: UInt8 = (density == 2) ? 0x9E : ((density == 5) ? 0x8B : 0x99)
      let densityPacket: [UInt8] = [0x51, 0x78, 0xA4, 0x00, 0x01, 0x00, densityByte, densityCrc, 0xFF]
      streamBuffer.append(contentsOf: densityPacket)

      // 2. Send thermal pulse burn energy command (0xAF) matching density
      // Light (2): 5000 us (0x1388), Normal (3): 6500 us (0x1964), Dark (5): 7500 us (0x1D4C)
      let energyVal: UInt16 = (density == 2) ? 5000 : ((density == 5) ? 7500 : 6500)
      let energyLow = UInt8(energyVal & 0xFF)
      let energyHigh = UInt8((energyVal >> 8) & 0xFF)
      let energyCrc = TinyPrinterModule.calcCrc8([energyLow, energyHigh])
      let energyPacket: [UInt8] = [0x51, 0x78, 0xAF, 0x00, 0x02, 0x00, energyLow, energyHigh, energyCrc, 0xFF]
      streamBuffer.append(contentsOf: energyPacket)

      // 3. Send printLattice matrix calibration command matching Android vendor SDK
      let printLatticeCmd: [UInt8] = [
        0x51, 0x78, 0xA6, 0x00, 0x0B, 0x00, 0xAA, 0x55, 0x17, 0x38, 0x44, 0x5F, 0x5F, 0x5F, 0x44, 0x38, 0x2C, 0xA1, 0xFF
      ]
      streamBuffer.append(contentsOf: printLatticeCmd)

      // 4. Send print_img mode command: 51 78 BE 00 01 00 00 00 FF
      let printImgCmd: [UInt8] = [0x51, 0x78, 0xBE, 0x00, 0x01, 0x00, 0x00, 0x00, 0xFF]
      streamBuffer.append(contentsOf: printImgCmd)

      // 5. Send motor print speed command (0xBD) - speed 10 = fast motor feed (matches Android imgPrintSpeed = 10)
      let speedByte: UInt8 = 0x0A
      let speedCrc = TinyPrinterModule.calcCrc8([speedByte])
      let speedPacket: [UInt8] = [0x51, 0x78, 0xBD, 0x00, 0x01, 0x00, speedByte, speedCrc, 0xFF]
      streamBuffer.append(contentsOf: speedPacket)

      // 6. Append all raster rows (each row packet is 56 bytes: 51 78 A2 00 30 00 [48 bytes] CRC FF)
      for rowData in rasterRows {
        streamBuffer.append(0x51)
        streamBuffer.append(0x78)
        streamBuffer.append(0xA2)
        streamBuffer.append(0x00)
        streamBuffer.append(0x30) // 48 bytes payload length
        streamBuffer.append(0x00)
        streamBuffer.append(contentsOf: rowData)
        let crc = TinyPrinterModule.calcCrc8(rowData)
        streamBuffer.append(crc)
        streamBuffer.append(0xFF)
      }

      // 7. Send finishLattice command after raster rows
      let finishLatticeCmd: [UInt8] = [
        0x51, 0x78, 0xA6, 0x00, 0x0B, 0x00, 0xAA, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x11, 0xFF
      ]
      streamBuffer.append(contentsOf: finishLatticeCmd)

      // 8. Paper feed (96 lines) matching Android vendor BluetoothOrder.paper2
      let feedLines: UInt8 = 96
      let feedPayload: [UInt8] = [feedLines, 0x00]
      let feedCrc = TinyPrinterModule.calcCrc8(feedPayload)
      let feedPacket: [UInt8] = [0x51, 0x78, 0xA1, 0x00, 0x02, 0x00, feedLines, 0x00, feedCrc, 0xFF]
      streamBuffer.append(contentsOf: feedPacket)

      // High-speed MTU chunk streaming matching Android Ble.writeEntity (packLength = defMTU - 3, delay = 1ms)
      let writeType: CBCharacteristicWriteType = writeChar.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
      let maxChunk = peripheral.maximumWriteValueLength(for: writeType)
      // Standard BLE MTU chunk: up to 168 bytes (3 rows per packet) or max MTU allowed
      let chunkSize = max(20, min(maxChunk, 168))

      let totalBytes = streamBuffer.count
      var offset = 0
      var lastReportedProgress = 0.0

      while offset < totalBytes {
        guard self.connectedPeripheral != nil else {
          promise.reject("ERR_DISCONNECTED", "Printer disconnected during printing")
          return
        }

        let length = min(chunkSize, totalBytes - offset)
        let chunkData = streamBuffer[offset..<(offset + length)]
        let data = Data(chunkData)

        // If using writeWithoutResponse, wait if the CoreBluetooth radio queue is momentarily full
        if writeType == .withoutResponse {
          var waitCount = 0
          while !peripheral.canSendWriteWithoutResponse && self.connectedPeripheral != nil && waitCount < 100 {
            Thread.sleep(forTimeInterval: 0.001)
            waitCount += 1
          }
        }

        peripheral.writeValue(data, for: writeChar, type: writeType)
        offset += length

        // Pacing delay matching Android vendor SDK (1ms per chunk gives fast, smooth ~2-3s receipt print)
        Thread.sleep(forTimeInterval: 0.001)

        let progress = Double(offset) / Double(totalBytes)
        if progress - lastReportedProgress >= 0.05 || offset >= totalBytes {
          lastReportedProgress = progress
          self.sendEvent("onPrintStatus", [
            "status": "progress",
            "progress": progress
          ])
        }
      }

      Thread.sleep(forTimeInterval: 0.2)
      self.sendEvent("onPrintStatus", ["status": "success"])

      // Refresh battery and status after printing
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        _ = self?.requestDeviceStatusInternal()
      }

      promise.resolve(["success": true])
    }
  }

  // MARK: - Bitmap & Graphics Processing

  private func scaleImageToWidth(image: UIImage, targetWidth: Int) -> UIImage {
    let scale = CGFloat(targetWidth) / image.size.width
    let targetHeight = max(1, Int(image.size.height * scale))
    let targetSize = CGSize(width: targetWidth, height: targetHeight)

    UIGraphicsBeginImageContextWithOptions(targetSize, true, 1.0)
    image.draw(in: CGRect(origin: .zero, size: targetSize))
    let scaled = UIGraphicsGetImageFromCurrentImageContext() ?? image
    UIGraphicsEndImageContext()
    return scaled
  }

  private func convertImageToRasterRows(image: UIImage, width: Int) -> [[UInt8]]? {
    let height = Int(image.size.height)
    guard width > 0, height > 0 else { return nil }

    let bytesPerRow = (width + 7) / 8 // 384 / 8 = 48 bytes
    var pixelData = [UInt8](repeating: 0, count: width * height * 4)

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
      data: &pixelData,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
      return nil
    }

    if let cgImage = image.cgImage {
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
    } else if let ciImage = image.ciImage {
      let ciContext = CIContext()
      if let cg = ciContext.createCGImage(ciImage, from: ciImage.extent) {
        context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
      }
    }

    var rows = [[UInt8]]()
    rows.reserveCapacity(height)

    for y in 0..<height {
      var rowBytes = [UInt8](repeating: 0, count: bytesPerRow)
      for x in 0..<width {
        let pixelIndex = (y * width + x) * 4
        let r = Double(pixelData[pixelIndex])
        let g = Double(pixelData[pixelIndex + 1])
        let b = Double(pixelData[pixelIndex + 2])
        let a = Double(pixelData[pixelIndex + 3])

        // Luminance calculation: black is printable, white is blank
        let luminance = a > 50 ? (0.299 * r + 0.587 * g + 0.114 * b) : 255.0
        let isBlack = luminance < 160.0 // Dot is black / burn thermal

        if isBlack {
          let byteIdx = x / 8
          let bitIdx = x % 8
          rowBytes[byteIdx] |= (1 << bitIdx)
        }
      }
      rows.append(rowBytes)
    }

    return rows
  }

  private func renderReceiptImage(data: [String: Any], width: Int) -> UIImage {
    let storeName = (data["storeName"] as? String) ?? "SE PAY - MANAH CREATIONS"
    let subtitle = (data["subtitle"] as? String) ?? "CONTACTLESS PAYMENT RECEIPT"
    let txnId = (data["txnId"] as? String) ?? "#TXN-\(Int(Date().timeIntervalSince1970) % 100000)"
    let amount = (data["amount"] as? String) ?? "$25.00"
    let tip = (data["tip"] as? String) ?? "$2.50"
    let total = (data["total"] as? String) ?? "$27.50"
    let cardType = (data["cardType"] as? String) ?? "Visa Tap to Pay"
    let cardLast4 = (data["cardLast4"] as? String) ?? "4242"
    let status = (data["status"] as? String) ?? "APPROVED"
    let authCode = (data["authCode"] as? String) ?? "AUTH: 839201"

    let dateFormatter = DateFormatter()
    dateFormatter.dateFormat = "dd-MMM-yyyy HH:mm:ss"
    let dateStr = dateFormatter.string(from: Date())

    let height: CGFloat = 680.0
    let size = CGSize(width: CGFloat(width), height: height)

    let renderer = UIGraphicsImageRenderer(size: size)
    return renderer.image { ctx in
      let cg = ctx.cgContext
      cg.setFillColor(UIColor.white.cgColor)
      cg.fill(CGRect(origin: .zero, size: size))

      let centerStyle = NSMutableParagraphStyle()
      centerStyle.alignment = .center

      let leftStyle = NSMutableParagraphStyle()
      leftStyle.alignment = .left

      let rightStyle = NSMutableParagraphStyle()
      rightStyle.alignment = .right

      var y: CGFloat = 28.0

      // Store Title
      let titleFont = UIFont.boldSystemFont(ofSize: 22)
      storeName.draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 28), withAttributes: [
        .font: titleFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
      y += 26.0

      // Subtitle
      let subFont = UIFont.systemFont(ofSize: 13, weight: .medium)
      subtitle.draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 20), withAttributes: [
        .font: subFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
      y += 22.0

      // Dashed line
      let dashFont = UIFont.systemFont(ofSize: 14)
      "------------------------------------------------".draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 20), withAttributes: [
        .font: dashFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
      y += 22.0

      // Date
      let bodyFont = UIFont.systemFont(ofSize: 14)
      "Date:".draw(in: CGRect(x: 16, y: y, width: 100, height: 20), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: leftStyle])
      dateStr.draw(in: CGRect(x: CGFloat(width) - 200, y: y, width: 184, height: 20), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: rightStyle])
      y += 24.0

      // Transaction ID
      "Transaction ID:".draw(in: CGRect(x: 16, y: y, width: 140, height: 20), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: leftStyle])
      txnId.draw(in: CGRect(x: CGFloat(width) - 180, y: y, width: 164, height: 20), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: rightStyle])
      y += 24.0

      // Payment method
      "Payment Method:".draw(in: CGRect(x: 16, y: y, width: 140, height: 20), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: leftStyle])
      "\(cardType) (**** \(cardLast4))".draw(in: CGRect(x: CGFloat(width) - 210, y: y, width: 194, height: 20), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: rightStyle])
      y += 24.0

      // Double line
      "================================================".draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 20), withAttributes: [
        .font: dashFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
      y += 26.0

      // Fare
      "Fare / Service:".draw(in: CGRect(x: 16, y: y, width: 140, height: 22), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: leftStyle])
      amount.draw(in: CGRect(x: CGFloat(width) - 140, y: y, width: 124, height: 22), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: rightStyle])
      y += 24.0

      // Tip
      "Tip:".draw(in: CGRect(x: 16, y: y, width: 100, height: 22), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: leftStyle])
      tip.draw(in: CGRect(x: CGFloat(width) - 140, y: y, width: 124, height: 22), withAttributes: [.font: bodyFont, .foregroundColor: UIColor.black, .paragraphStyle: rightStyle])
      y += 28.0

      // Total
      let totalFont = UIFont.boldSystemFont(ofSize: 22)
      "TOTAL PAID:".draw(in: CGRect(x: 16, y: y, width: 160, height: 28), withAttributes: [.font: totalFont, .foregroundColor: UIColor.black, .paragraphStyle: leftStyle])
      total.draw(in: CGRect(x: CGFloat(width) - 170, y: y, width: 154, height: 28), withAttributes: [.font: totalFont, .foregroundColor: UIColor.black, .paragraphStyle: rightStyle])
      y += 32.0

      // Dash line
      "------------------------------------------------".draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 20), withAttributes: [
        .font: dashFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
      y += 26.0

      // Status Badge
      let statusFont = UIFont.boldSystemFont(ofSize: 19)
      "[ \(status) ]".draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 24), withAttributes: [
        .font: statusFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
      y += 24.0

      // Auth code
      let authFont = UIFont.systemFont(ofSize: 13)
      authCode.draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 18), withAttributes: [
        .font: authFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
      y += 26.0

      // Simulated barcode lines
      cg.setStrokeColor(UIColor.black.cgColor)
      var barX: CGFloat = 36.0
      var i = 0
      while barX < CGFloat(width) - 36.0 {
        let barW: CGFloat = (i % 3 == 0) ? 3.0 : 1.5
        cg.setLineWidth(barW)
        cg.move(to: CGPoint(x: barX, y: y))
        cg.addLine(to: CGPoint(x: barX, y: y + 30.0))
        cg.strokePath()
        barX += (i % 4 == 0) ? 6.5 : 4.0
        i += 1
      }
      y += 42.0

      // Footer
      let footerFont = UIFont.systemFont(ofSize: 12)
      "*** Thank you for using SE Pay ***".draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 18), withAttributes: [
        .font: footerFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
      y += 18.0
      "Customer Copy".draw(in: CGRect(x: 10, y: y, width: CGFloat(width) - 20, height: 18), withAttributes: [
        .font: footerFont,
        .foregroundColor: UIColor.black,
        .paragraphStyle: centerStyle
      ])
    }
  }
}
