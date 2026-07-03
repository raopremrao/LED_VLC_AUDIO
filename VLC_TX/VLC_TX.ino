#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "QueueManager.h"
#include "OpticalTX.h"

// Configuration
const int LASER_PIN = 2;
const int OPTICAL_BAUD = 115200;
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"

// Globals
OpticalTX* opticalTx;
QueueManager* bleRxQueue;
bool deviceConnected = false;

// Max BLE packet size + some overhead
#define MAX_BLE_PACKET 256 

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
        
        if (rxLength > 0 && rxLength <= MAX_BLE_PACKET) {
            // We just forward the raw framed packet from the browser to the optical link.
            // Push to queue so we don't block the BLE stack
            uint8_t buffer[MAX_BLE_PACKET + 2]; // store length + data
            buffer[0] = (rxLength >> 8) & 0xFF;
            buffer[1] = rxLength & 0xFF;
            memcpy(&buffer[2], rxData, rxLength);
            
            bleRxQueue->enqueue(buffer);
        }
    }
};

void TaskOpticalTX(void *pvParameters) {
    uint8_t buffer[MAX_BLE_PACKET + 2];
    for (;;) {
        if (bleRxQueue->dequeue(buffer, portMAX_DELAY)) {
            size_t length = (buffer[0] << 8) | buffer[1];
            opticalTx->writeData(&buffer[2], length);
        }
    }
}

void setup() {
    Serial.begin(115200);
    Serial.println("[INFO] Booting VLC_TX...");

    opticalTx = new OpticalTX(LASER_PIN, OPTICAL_BAUD);
    opticalTx->begin();

    bleRxQueue = new QueueManager(MAX_BLE_PACKET + 2, 50); // Queue up to 50 packets

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

    xTaskCreatePinnedToCore(
        TaskOpticalTX,
        "OptTX",
        4096,
        NULL,
        2, // Priority
        NULL,
        1  // Core 1 (leave Core 0 for BLE/WiFi)
    );
}

void loop() {
    vTaskDelay(portMAX_DELAY); // FreeRTOS handles the rest
}
