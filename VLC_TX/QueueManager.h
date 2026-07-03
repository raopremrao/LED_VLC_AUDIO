#ifndef QUEUE_MANAGER_H
#define QUEUE_MANAGER_H

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

class QueueManager {
public:
    QueueManager(size_t itemSize, size_t queueLength);
    ~QueueManager();

    bool enqueue(const void* item, TickType_t ticksToWait = 0);
    bool dequeue(void* item, TickType_t ticksToWait = portMAX_DELAY);
    size_t getCount();
    void clear();

private:
    QueueHandle_t _queue;
};

#endif
