#include "QueueManager.h"

QueueManager::QueueManager(size_t itemSize, size_t queueLength) {
    _queue = xQueueCreate(queueLength, itemSize);
}

QueueManager::~QueueManager() {
    if (_queue != NULL) {
        vQueueDelete(_queue);
    }
}

bool QueueManager::enqueue(const void* item, TickType_t ticksToWait) {
    if (_queue == NULL) return false;
    return xQueueSend(_queue, item, ticksToWait) == pdTRUE;
}

bool QueueManager::dequeue(void* item, TickType_t ticksToWait) {
    if (_queue == NULL) return false;
    return xQueueReceive(_queue, item, ticksToWait) == pdTRUE;
}

size_t QueueManager::getCount() {
    if (_queue == NULL) return 0;
    return uxQueueMessagesWaiting(_queue);
}

void QueueManager::clear() {
    if (_queue != NULL) {
        xQueueReset(_queue);
    }
}
