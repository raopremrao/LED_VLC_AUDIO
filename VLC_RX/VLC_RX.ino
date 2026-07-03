#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "QueueManager.h"
#include "OpticalRX.h"
#include "PacketDecoder.h"
#include "CRC16.h"

// Configuration
const int PHOTODIODE_PIN = 34;
const int OPTICAL_BAUD = 9600; 
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// Globals
OpticalRX* opticalRx;
QueueManager* bleTxQueue;
PacketDecoder* packetDecoder;
BLECharacteristic *pTxCharacteristic;
volatile bool deviceConnected = false;

// Statistics
uint32_t totalOpticalBytesRead = 0;
uint32_t blePacketsSent = 0;
uint32_t blePacketsDroppedNoConn = 0;
uint32_t queueFullDrops = 0;
unsigned long lastStatsTime = 0;
const unsigned long STATS_INTERVAL_MS = 5000;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
        deviceConnected = true;
        Serial.println("[INFO] Browser Connected to RX");
    }
    void onDisconnect(BLEServer* pServer) {
        deviceConnected = false;
        Serial.println("[WARN] Browser Disconnected from RX");
        BLEDevice::startAdvertising();
    }
};

/**
 * Helper: Build a full framed packet into outBuffer for BLE transmission.
 * Returns total packet size including SYNC, header, payload, CRC.
 */
size_t buildFramedPacket(uint8_t* outBuffer, uint8_t type, uint16_t sequence,
                         const uint8_t* payload, uint16_t payloadLen, uint8_t flags = 0) {
    outBuffer[0] = 0xAA;  // SYNC1
    outBuffer[1] = 0x55;  // SYNC2
    outBuffer[2] = 0x01;  // VERSION
    outBuffer[3] = type;
    outBuffer[4] = flags;
    outBuffer[5] = (sequence >> 8) & 0xFF;
    outBuffer[6] = sequence & 0xFF;
    outBuffer[7] = (payloadLen >> 8) & 0xFF;
    outBuffer[8] = payloadLen & 0xFF;

    if (payloadLen > 0 && payload != nullptr) {
        memcpy(&outBuffer[9], payload, payloadLen);
    }

    uint16_t crc = CRC16::calculate(&outBuffer[2], 7 + payloadLen);
    size_t crcIdx = 9 + payloadLen;
    outBuffer[crcIdx] = (crc >> 8) & 0xFF;
    outBuffer[crcIdx + 1] = crc & 0xFF;

    return crcIdx + 2;
}

/**
 * Helper: Enqueue a framed packet for BLE transmission with error checking.
 */
bool enqueueForBLE(uint8_t* packetData, size_t packetLen) {
    uint8_t qBuf[258];
    qBuf[0] = (packetLen >> 8) & 0xFF;
    qBuf[1] = packetLen & 0xFF;
    memcpy(&qBuf[2], packetData, packetLen);

    if (!bleTxQueue->enqueue(qBuf)) {
        queueFullDrops++;
        Serial.printf("[WARN] BLE TX queue full! Packet dropped. Total queue drops: %d\n", queueFullDrops);
        return false;
    }
    return true;
}

void TaskOpticalRX(void *pvParameters) {
    uint8_t readBuf[256];
    ParsedPacket parsedPacket;

    Serial.println("[INFO] Optical RX task started. Waiting for light data...");

    for (;;) {
        if (opticalRx->available()) {
            size_t len = opticalRx->readData(readBuf, sizeof(readBuf));
            totalOpticalBytesRead += len;

            Serial.printf("[RX] Photodiode: %d bytes (total: %d bytes)\n", len, totalOpticalBytesRead);

            // Hex dump first 512 bytes for diagnostics — helps identify noise vs real data
            if (totalOpticalBytesRead <= 512) {
                Serial.print("[HEX] ");
                for (size_t h = 0; h < len && h < 32; h++) {
                    Serial.printf("%02X ", readBuf[h]);
                }
                Serial.println();
            }

            for (size_t i = 0; i < len; i++) {
                if (packetDecoder->processByte(readBuf[i], &parsedPacket)) {
                    Serial.printf("[RX] VALID PACKET! Type: %d, Seq: %d, Len: %d (Total valid: %d)\n",
                                  parsedPacket.type, parsedPacket.sequence, parsedPacket.length,
                                  packetDecoder->validPackets);

                    // Rebuild the full framed packet for browser's PacketParser
                    uint8_t bleBuffer[256];
                    size_t totalLen = buildFramedPacket(bleBuffer, parsedPacket.type,
                                                       parsedPacket.sequence,
                                                       parsedPacket.payload,
                                                       parsedPacket.length,
                                                       parsedPacket.flags);

                    enqueueForBLE(bleBuffer, totalLen);

                } else if (packetDecoder->hasCrcError()) {
                    packetDecoder->clearCrcError();

                    // Build and send ERROR packet to browser
                    const char* msg = "CRC Failed! Optical noise detected.";
                    uint8_t bleBuffer[256];
                    size_t totalLen = buildFramedPacket(bleBuffer, 0x07 /* ERROR */, 0,
                                                       (const uint8_t*)msg, strlen(msg));

                    enqueueForBLE(bleBuffer, totalLen);
                    Serial.printf("[RX] CRC error forwarded to browser. Total CRC errors: %d\n",
                                  packetDecoder->crcErrors);
                }
            }
        }

        // Periodic statistics report
        if (millis() - lastStatsTime > STATS_INTERVAL_MS) {
            lastStatsTime = millis();
            if (totalOpticalBytesRead > 0 || packetDecoder->validPackets > 0) {
                Serial.printf("[STATS] OpticalBytes: %d | ValidPkts: %d | CRC Errors: %d | InvalidHdr: %d | QueueDrops: %d | BLE Sent: %d | UART Overflow: %d\n",
                              totalOpticalBytesRead, packetDecoder->validPackets,
                              packetDecoder->crcErrors, packetDecoder->invalidHeaders,
                              queueFullDrops, blePacketsSent,
                              opticalRx->overflowCount);
            }
        }

        vTaskDelay(pdMS_TO_TICKS(5)); // Yield
    }
}

void TaskBLE_TX(void *pvParameters) {
    uint8_t qBuf[258];

    Serial.println("[INFO] BLE TX task started.");

    for (;;) {
        if (bleTxQueue->dequeue(qBuf, portMAX_DELAY)) {
            if (deviceConnected) {
                size_t len = (qBuf[0] << 8) | qBuf[1];
                pTxCharacteristic->setValue(&qBuf[2], len);
                pTxCharacteristic->notify();
                blePacketsSent++;

                if (blePacketsSent % 50 == 0) {
                    Serial.printf("[BLE_TX] Sent %d packets to browser. Queue remaining: %d\n",
                                  blePacketsSent, bleTxQueue->getCount());
                }

                // Small delay to prevent BLE stack overflow
                vTaskDelay(pdMS_TO_TICKS(10));
            } else {
                blePacketsDroppedNoConn++;
                Serial.printf("[WARN] BLE not connected. Packet dropped. Total no-conn drops: %d\n",
                              blePacketsDroppedNoConn);
            }
        }
    }
}

void setup() {
    Serial.begin(115200);
    delay(1000); // Wait for Serial to be ready
    Serial.println("====================================");
    Serial.println("[INFO] Booting VLC_RX Pro...");
    Serial.println("====================================");

    opticalRx = new OpticalRX(PHOTODIODE_PIN, OPTICAL_BAUD);
    opticalRx->begin();

    bleTxQueue = new QueueManager(258, 20); // Queue up to 20 packets
    packetDecoder = new PacketDecoder();

    Serial.printf("[INFO] Free heap after init: %d bytes\n", ESP.getFreeHeap());

    BLEDevice::init("VLC_RX_Pro");
    BLEDevice::setMTU(512);

    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    BLEService *pService = pServer->createService(SERVICE_UUID);
    pTxCharacteristic = pService->createCharacteristic(
        CHARACTERISTIC_UUID_TX,
        BLECharacteristic::PROPERTY_NOTIFY
    );
    pTxCharacteristic->addDescriptor(new BLE2902());

    pService->start();
    pServer->getAdvertising()->start();

    Serial.println("[INFO] VLC_RX BLE Advertising...");
    Serial.printf("[INFO] Free heap after BLE init: %d bytes\n", ESP.getFreeHeap());

    xTaskCreatePinnedToCore(TaskOpticalRX, "OptRX", 4096, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(TaskBLE_TX, "BleTX", 4096, NULL, 2, NULL, 1);

    Serial.println("[INFO] VLC_RX fully initialized. Waiting for optical data...");
}

void loop() {
    vTaskDelay(portMAX_DELAY);
}
