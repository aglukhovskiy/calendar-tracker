/******/ (() => { // webpackBootstrap
class DayDetails {
  constructor() {
    this.storageKey = 'allDayDetails'; // Единый ключ для всех деталей дня
    this.currentDate = null; // Дата, для которой открыта модалка
    this.initializeEventListeners();
  }
  initializeEventListeners() {
    // Обработчик для открытия модального окна (остается в main_page.js или вешается им)
    // Этот класс будет предоставлять метод openDayDetailModal

    const saveButton = document.getElementById('day-detail-save');
    const cancelButton = document.getElementById('day-detail-cancel');
    // Кнопка закрытия из main_page.js должна закрывать и эту модалку
    // const closeButton = document.querySelector('#day-detail-modal .close-modal'); // Уже есть в main_page.js

    if (saveButton) {
      saveButton.addEventListener('click', () => this.saveDayDetails());
    }
    if (cancelButton) {
      cancelButton.addEventListener('click', () => this.closeDayDetailModal());
    }

    // Обновление общей суммы калорий при вводе
    ['calories-morning', 'calories-afternoon', 'calories-evening'].forEach(id => {
      const input = document.getElementById(id);
      if (input) {
        input.addEventListener('input', () => this.updateTotalCaloriesDisplay());
      }
    });
  }
  openDayDetailModal(date) {
    this.currentDate = date;
    const modal = document.getElementById('day-detail-modal');
    const header = document.getElementById('day-detail-header');
    chrome.storage.local.get(this.storageKey, result => {
      const allDayDetails = result[this.storageKey] || {};
      const dayData = allDayDetails[date] || {
        calories: {
          morning: 0,
          afternoon: 0,
          evening: 0
        },
        comment: ''
      };

      // Убедимся, что дата парсится корректно (добавляем время, чтобы избежать проблем с часовыми поясами)
      const dateObj = new Date(date + "T00:00:00");
      header.textContent = `Детали дня: ${dateObj.toLocaleDateString('ru-RU', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}`;
      document.getElementById('calories-morning').value = dayData.calories.morning || 0;
      document.getElementById('calories-afternoon').value = dayData.calories.afternoon || 0;
      document.getElementById('calories-evening').value = dayData.calories.evening || 0;
      document.getElementById('day-comment').value = dayData.comment || '';
      this.updateTotalCaloriesDisplay();
      modal.style.display = 'block';
    });
  }
  closeDayDetailModal() {
    const modal = document.getElementById('day-detail-modal');
    modal.style.display = 'none';
    this.currentDate = null;
  }
  saveDayDetails() {
    if (!this.currentDate) return;
    const date = this.currentDate;
    chrome.storage.local.get(this.storageKey, result => {
      const allDayDetails = result[this.storageKey] || {};
      allDayDetails[date] = {
        calories: {
          morning: parseInt(document.getElementById('calories-morning').value) || 0,
          afternoon: parseInt(document.getElementById('calories-afternoon').value) || 0,
          evening: parseInt(document.getElementById('calories-evening').value) || 0
        },
        comment: document.getElementById('day-comment').value.trim()
      };
      chrome.storage.local.set({
        [this.storageKey]: allDayDetails
      }, () => {
        // console.log('Day details saved for', date);
        // main_page.js должен отреагировать на chrome.storage.onChanged и обновить UI
        this.closeDayDetailModal();
      });
    });
  }
  updateTotalCaloriesDisplay() {
    // Эта функция может понадобиться, если в HTML модального окна есть место для отображения суммы
    // Например, <span id="total-calories-value-in-modal">0</span>
    const totalCaloriesEl = document.getElementById('total-calories-value-in-modal'); // Пример ID
    if (!totalCaloriesEl && !document.getElementById('calories-morning')) return; // Выходим, если нет элементов

    const morning = parseInt(document.getElementById('calories-morning').value) || 0;
    const afternoon = parseInt(document.getElementById('calories-afternoon').value) || 0;
    const evening = parseInt(document.getElementById('calories-evening').value) || 0;
    const total = morning + afternoon + evening;
    if (totalCaloriesEl) {
      totalCaloriesEl.textContent = total;
    }
  }
}

// Инициализация объекта DayDetails будет производиться из main_page.js
// после полной загрузки DOM и первоначального рендеринга.
// Убираем DOMContentLoaded listener отсюда, чтобы избежать конфликтов.
/******/ })()
;
//# sourceMappingURL=dayDetails.bundle.js.map