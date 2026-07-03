#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "QueueManager.h"
#include "OpticalRX.h"
#include "PacketDecoder.h"

// Configuration
const int PHOTODIODE_PIN = 34;
const int OPTICAL_BAUD = 115200;
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

// Globals
OpticalRX* opticalRx;
QueueManager* bleTxQueue;
PacketDecoder* packetDecoder;
BLECharacteristic *pTxCharacteristic;
bool deviceConnected = false;

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

void TaskOpticalRX(void *pvParameters) {
    uint8_t readBuf[256];
    ParsedPacket parsedPacket;
    
    for (;;) {
        if (opticalRx->available()) {
            size_t len = opticalRx->readData(readBuf, sizeof(readBuf));
            for (size_t i = 0; i < len; i++) {
                if (packetDecoder->processByte(readBuf[i], &parsedPacket)) {
                    // Valid packet successfully reconstructed from optical stream.
                    // Push to BLE Queue to be sent to browser.
                    // We must rebuild the raw bytes for the browser to parse (including headers).
                    // Or we could let the browser do what it does. Since the browser 
                    // is designed to parse the raw byte stream as well, we can just send the valid payload?
                    // Actually, the browser has PacketParser. It expects the FULL packet including SYNC.
                    // Let's reconstruct the raw packet array to send over BLE.
                    uint8_t bleBuffer[256];
                    bleBuffer[0] = PACKET_SYNC1;
                    bleBuffer[1] = PACKET_SYNC2;
                    bleBuffer[2] = parsedPacket.version;
                    bleBuffer[3] = parsedPacket.type;
                    bleBuffer[4] = parsedPacket.flags;
                    bleBuffer[5] = (parsedPacket.sequence >> 8) & 0xFF;
                    bleBuffer[6] = parsedPacket.sequence & 0xFF;
                    bleBuffer[7] = (parsedPacket.length >> 8) & 0xFF;
                    bleBuffer[8] = parsedPacket.length & 0xFF;
                    if (parsedPacket.length > 0) {
                        memcpy(&bleBuffer[9], parsedPacket.payload, parsedPacket.length);
                    }
                    
                    // Recompute CRC or just use a dummy one?
                    // Actually we validated it, let's just forward it as is, we'll recompute for simplicity
                    uint16_t crc = CRC16::calculate(&bleBuffer[2], 7 + parsedPacket.length);
                    size_t crcIdx = 9 + parsedPacket.length;
                    bleBuffer[crcIdx] = (crc >> 8) & 0xFF;
                    bleBuffer[crcIdx + 1] = crc & 0xFF;
                    
                    size_t totalLen = crcIdx + 2;
                    
                    // Send to queue (Length + Data)
                    uint8_t qBuf[258];
                    qBuf[0] = (totalLen >> 8) & 0xFF;
                    qBuf[1] = totalLen & 0xFF;
                    memcpy(&qBuf[2], bleBuffer, totalLen);
                    
                    bleTxQueue->enqueue(qBuf);
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(5)); // Yield
    }
}

void TaskBLE_TX(void *pvParameters) {
    uint8_t qBuf[258];
    for (;;) {
        if (bleTxQueue->dequeue(qBuf, portMAX_DELAY)) {
            if (deviceConnected) {
                size_t len = (qBuf[0] << 8) | qBuf[1];
                pTxCharacteristic->setValue(&qBuf[2], len);
                pTxCharacteristic->notify();
                // Small delay to prevent BLE stack overflow
                vTaskDelay(pdMS_TO_TICKS(10)); 
            }
        }
    }
}

void setup() {
    Serial.begin(115200);
    Serial.println("[INFO] Booting VLC_RX...");

    opticalRx = new OpticalRX(PHOTODIODE_PIN, OPTICAL_BAUD);
    opticalRx->begin();

    bleTxQueue = new QueueManager(258, 20); // Queue up to 20 packets
    packetDecoder = new PacketDecoder();

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

    xTaskCreatePinnedToCore(TaskOpticalRX, "OptRX", 4096, NULL, 3, NULL, 1);
    xTaskCreatePinnedToCore(TaskBLE_TX, "BleTX", 4096, NULL, 2, NULL, 1);
}

void loop() {
    vTaskDelay(portMAX_DELAY);
}
