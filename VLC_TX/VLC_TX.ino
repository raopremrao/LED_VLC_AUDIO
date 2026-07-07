#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "QueueManager.h"
#include "OpticalTX.h"

// Configuration
const int LASER_PIN = 2;
const int OPTICAL_BAUD = 2500; 
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"

// Globals
OpticalTX* opticalTx;
QueueManager* bleRxQueue;
volatile bool deviceConnected = false;

// Max BLE packet size + 2 bytes for length prefix
#define MAX_BLE_PACKET 512

// Statistics
uint32_t blePacketsReceived = 0;
uint32_t queueFullDrops = 0;
uint32_t opticalPacketsSent = 0;
unsigned long lastStatsTime = 0;
const unsigned long STATS_INTERVAL_MS = 5000;

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
        deviceConnected = true;
        Serial.println("[INFO] Browser Connected to TX");
    }
    void onDisconnect(BLEServer* pServer) {
        deviceConnected = false;
        Serial.println("[WARN] Browser Disconnected from TX");
        BLEDevice::startAdvertising();
    }
};

class MyRxCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        uint8_t* rxData = pCharacteristic->getData();
        size_t rxLength = pCharacteristic->getLength();

        if (rxLength > 4 && strncmp((const char*)rxData, "CMD:", 4) == 0) {
            String cmdStr = String((const char*)rxData).substring(0, rxLength);
            // Serial.println("[CMD] Received command: " + cmdStr);
            if (cmdStr.startsWith("CMD:BAUD:")) {
                int newBaud = cmdStr.substring(9).toInt();
                if (newBaud > 0) {
                    // Serial.printf("[CMD] Changing Optical Baud to %d\n", newBaud);
                    opticalTx->updateBaudRate(newBaud);
                }
            }
            return;
        }

        if (rxLength > 0 && rxLength <= MAX_BLE_PACKET) {
            blePacketsReceived++;

            // Forward raw framed packet from browser to optical link via queue
            uint8_t buffer[MAX_BLE_PACKET + 2]; // Length prefix + data
            buffer[0] = (rxLength >> 8) & 0xFF;
            buffer[1] = rxLength & 0xFF;
            memcpy(&buffer[2], rxData, rxLength);

            if (!bleRxQueue->enqueue(buffer)) {
                queueFullDrops++;
                // Serial.printf("[WARN] Optical TX queue full! Packet dropped. BLE recv: %d, Queue drops: %d\n",
                //               blePacketsReceived, queueFullDrops);
            } else {
                // if (blePacketsReceived % 50 == 0) {
                //     Serial.printf("[BLE_RX] Received %d packets from browser. Queue: %d/%d\n",
                //                   blePacketsReceived, bleRxQueue->getCount(), 50);
                // }
            }
        } else {
            Serial.printf("[WARN] Invalid BLE packet size: %d bytes (max %d)\n", rxLength, MAX_BLE_PACKET);
        }
    }
};

void TaskOpticalTX(void *pvParameters) {
    uint8_t buffer[MAX_BLE_PACKET + 2];

    Serial.println("[INFO] Optical TX task started. Waiting for BLE data...");

    for (;;) {
        if (bleRxQueue->dequeue(buffer, portMAX_DELAY)) {
            size_t length = (buffer[0] << 8) | buffer[1];
            opticalTx->writeData(&buffer[2], length);
            opticalPacketsSent++;

            // if (opticalPacketsSent % 50 == 0) {
            //     Serial.printf("[OPTICAL_TX] Sent %d packets over laser. Total bytes: %d. Queue: %d\n",
            //                   opticalPacketsSent, opticalTx->totalBytesSent, bleRxQueue->getCount());
            // }
        }

        // Periodic statistics report
        if (millis() - lastStatsTime > STATS_INTERVAL_MS) {
            lastStatsTime = millis();
            // if (blePacketsReceived > 0 || opticalPacketsSent > 0) {
            //     Serial.printf("[STATS] BLE Recv: %d | Optical Sent: %d | Bytes: %d | Queue Drops: %d | Free Heap: %d\n",
            //                   blePacketsReceived, opticalPacketsSent,
            //                   opticalTx->totalBytesSent, queueFullDrops,
            //                   ESP.getFreeHeap());
            // }
        }
    }
}

void setup() {
    Serial.begin(115200);
    Serial.println("====================================");
    Serial.println("[INFO] Booting VLC_TX Pro...");
    Serial.println("====================================");

    opticalTx = new OpticalTX(LASER_PIN, OPTICAL_BAUD);
    opticalTx->begin();

    bleRxQueue = new QueueManager(MAX_BLE_PACKET + 2, 50); // Queue up to 50 packets

    Serial.printf("[INFO] Free heap after init: %d bytes\n", ESP.getFreeHeap());

    BLEDevice::init("VLC_TX_Pro");
    BLEDevice::setMTU(512); // Request large MTU

    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    BLEService *pService = pServer->createService(SERVICE_UUID);
    BLECharacteristic *pRxCharacteristic = pService->createCharacteristic(
        CHARACTERISTIC_UUID_RX,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
    );
    pRxCharacteristic->setCallbacks(new MyRxCallbacks());

    pService->start();
    pServer->getAdvertising()->start();

    Serial.println("[INFO] VLC_TX BLE Advertising...");
    Serial.printf("[INFO] Free heap after BLE init: %d bytes\n", ESP.getFreeHeap());

    xTaskCreatePinnedToCore(
        TaskOpticalTX,
        "OptTX",
        4096,
        NULL,
        2, // Priority
        NULL,
        1  // Core 1 (leave Core 0 for BLE/WiFi)
    );

    Serial.println("[INFO] VLC_TX fully initialized. Waiting for browser connection...");
}

void loop() {
    vTaskDelay(portMAX_DELAY); // FreeRTOS handles the rest
}
