// Определяем, находимся ли мы в контексте расширения Chrome
const isChromeExtension = typeof chrome !== 'undefined' && chrome.storage;

// Абстракция для работы с хранилищем
export const storage = {
    async get(keys) {
        if (isChromeExtension) {
            return new Promise(resolve => {
                chrome.storage.local.get(keys, resolve);
            });
        } else {
            // Для веб-версии используем localStorage
            const result = {};
            if (Array.isArray(keys)) {
                keys.forEach(key => {
                    const value = localStorage.getItem(key);
                    if (value !== null) {
                        try {
                            result[key] = JSON.parse(value);
                        } catch (e) {
                            result[key] = value;
                        }
                    }
                });
            } else {
                const value = localStorage.getItem(keys);
                if (value !== null) {
                    try {
                        result[keys] = JSON.parse(value);
                    } catch (e) {
                        result[keys] = value;
                    }
                }
            }
            return result;
        }
    },

    async set(items) {
        if (isChromeExtension) {
            return new Promise(resolve => {
                chrome.storage.local.set(items, resolve);
            });
        } else {
            // Для веб-версии используем localStorage
            Object.entries(items).forEach(([key, value]) => {
                localStorage.setItem(key, JSON.stringify(value));
            });
        }
    },

    async remove(keys) {
        if (isChromeExtension) {
            return new Promise(resolve => {
                chrome.storage.local.remove(keys, resolve);
            });
        } else {
            // Для веб-версии используем localStorage
            if (Array.isArray(keys)) {
                keys.forEach(key => localStorage.removeItem(key));
            } else {
                localStorage.removeItem(keys);
            }
        }
    }
}; 