// DOM элементы
export const elements = {
    dayDetailModal: null,
    dayDetailModalDateDisplay: null,
    caloriesMorningInput: null,
    caloriesAfternoonInput: null,
    caloriesEveningInput: null,
    commentInput: null,
    totalCaloriesValueSpan: null,
    saveDayDetailsBtn: null,
    cancelDayDetailsBtn: null
};

// Функция для инициализации DOM элементов
export function initializeElements() {
    elements.dayDetailModal = document.getElementById('day-detail-modal');
    elements.dayDetailModalDateDisplay = document.getElementById('day-detail-modal-date-display');
    elements.caloriesMorningInput = document.getElementById('calories-morning');
    elements.caloriesAfternoonInput = document.getElementById('calories-afternoon');
    elements.caloriesEveningInput = document.getElementById('calories-evening');
    elements.commentInput = document.getElementById('day-comment');
    elements.totalCaloriesValueSpan = document.getElementById('total-calories-value');
    elements.saveDayDetailsBtn = document.getElementById('day-detail-save');
    elements.cancelDayDetailsBtn = document.getElementById('day-detail-cancel');

    // Проверяем наличие всех необходимых элементов
    const missingElements = Object.entries(elements)
        .filter(([_, element]) => !element)
        .map(([name]) => name);

    if (missingElements.length > 0) {
        console.error('Не найдены следующие DOM элементы:', missingElements);
        return false;
    }

    return true;
} 