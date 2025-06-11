// DOM элементы
export const elements = {
    // Модальные окна
    dayDetailModal: null,
    eventModal: null,
    
    // Элементы модального окна деталей дня
    dayDetailModalDateDisplay: null,
    caloriesMorningInput: null,
    caloriesAfternoonInput: null,
    caloriesEveningInput: null,
    commentInput: null,
    totalCaloriesValueSpan: null,
    saveDayDetailsBtn: null,
    cancelDayDetailsBtn: null,
    
    // Элементы модального окна событий
    eventModalTitle: null,
    eventModalDescription: null,
    eventModalDate: null,
    eventModalStartTime: null,
    eventModalEndTime: null,
    eventModalProjectSelect: null,
    eventModalTypeSelect: null,
    saveEventBtn: null,
    deleteEventBtn: null,
    cancelEventBtn: null,
    
    // Элементы навигации
    prevWeekBtn: null,
    currentWeekBtn: null,
    nextWeekBtn: null,
    
    // Элементы сетки
    weekGrid: null,
    daysHeader: null,
    timeSlotsContainer: null
};

// Функция для инициализации DOM элементов
export function initializeElements() {
    // Модальные окна
    elements.dayDetailModal = document.getElementById('day-detail-modal');
    elements.eventModal = document.getElementById('event-modal');
    
    // Элементы модального окна деталей дня
    elements.dayDetailModalDateDisplay = document.getElementById('day-detail-modal-date-display');
    elements.caloriesMorningInput = document.getElementById('calories-morning');
    elements.caloriesAfternoonInput = document.getElementById('calories-afternoon');
    elements.caloriesEveningInput = document.getElementById('calories-evening');
    elements.commentInput = document.getElementById('day-comment');
    elements.totalCaloriesValueSpan = document.getElementById('total-calories-value');
    elements.saveDayDetailsBtn = document.getElementById('day-detail-save');
    elements.cancelDayDetailsBtn = document.getElementById('day-detail-cancel');
    
    // Элементы модального окна событий
    elements.eventModalTitle = document.getElementById('event-title');
    elements.eventModalDescription = document.getElementById('event-description');
    elements.eventModalDate = document.getElementById('event-date');
    elements.eventModalStartTime = document.getElementById('event-start-time');
    elements.eventModalEndTime = document.getElementById('event-end-time');
    elements.eventModalProjectSelect = document.getElementById('event-project-select');
    elements.eventModalTypeSelect = document.getElementById('event-type-select');
    elements.saveEventBtn = document.getElementById('save-event');
    elements.deleteEventBtn = document.getElementById('delete-event');
    elements.cancelEventBtn = document.getElementById('cancel-event');
    
    // Элементы навигации
    elements.prevWeekBtn = document.getElementById('prev-week');
    elements.currentWeekBtn = document.getElementById('current-week');
    elements.nextWeekBtn = document.getElementById('next-week');
    
    // Элементы сетки
    elements.weekGrid = document.getElementById('week-grid');
    elements.daysHeader = document.querySelector('.days-header');
    elements.timeSlotsContainer = document.querySelector('.time-slots-container');

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