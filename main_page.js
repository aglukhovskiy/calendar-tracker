import { db } from './supabase';
import { storage } from './storage';
import { elements, initializeElements } from './dom-elements';

// === Globals ===
let calendarEvents = [];
let projects = [];
console.log('Global projects initialized:', projects);
let selectedProjectId = null;
let regularEventsConfig = []; // Хранит конфигурации регулярных событий
// stopwatch.startTimestamp будет хранить время начала в виде timestamp (Date.now())
// stopwatch.elapsed не используется активно, если startTimeStamp есть, его можно вычислять
let stopwatch = { isRunning: false, startTimestamp: null, elapsed: 0, liveEventId: null, projectId: null };
let stopwatchInterval = null;
let currentDate = new Date();
let currentWeekStart = getStartOfWeek(currentDate);
let editingEventId = null;

let allDayDetailsData = {}; // Кеш для данных о калориях и комментариях
const ALL_DAY_DETAILS_KEY = 'allDayDetails';
let dayDetailsManager = null; // Экземпляр класса DayDetails

// ==== UTILS ====
function formatDate(date) {
    const d = new Date(date);
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();
    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;
    return [year, month, day].join('-');
}

function pad(x) { return x.toString().padStart(2, '0'); }

function getStartOfWeek(date) {
    let d = new Date(date);
    let day = d.getDay();
    let diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0,0,0,0);
    return d;
}

function getWeekDates(startDate) {
    let week = [];
    for(let i=0;i<7;i++) {
        let d=new Date(startDate);
        d.setDate(d.getDate()+i);
        week.push(new Date(d));
    }
    return week;
}

function minutesSinceMidnight(dateObj) {
    return dateObj.getHours()*60 + dateObj.getMinutes();
}

function localIso(dt) {
    return dt.getFullYear() + '-' + pad(dt.getMonth()+1) + '-' + pad(dt.getDate()) + 'T' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
}

function localToDate(str) {
    const [y,m,d] = [str.slice(0,4), str.slice(5,7), str.slice(8,10)];
    const [hh,mm] = [str.slice(11,13), str.slice(14,16)];
    return new Date(+y, +m-1, +d, +hh, +mm);
}

function getLocalDateString(dt) {
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
}

// Функция для правильной обработки строк CSV
function parseCSVRow(text) {
    if (!text) return [];

    const result = [];
    let cell = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const char = text[i];

        if (char === '"') {
            // Проверка на экранированную кавычку
            if (inQuotes && i+1 < text.length && text[i+1] === '"') {
                cell += '"';
                i += 2; // Пропускаем следующую кавычку
                continue;
            }

            inQuotes = !inQuotes;
            i++;
            continue;
        }

        if (char === ';' && !inQuotes) {
            result.push(cell);
            cell = '';
            i++;
            continue;
        }

        cell += char;
        i++;
    }

    result.push(cell); // Добавляем последнюю ячейку
    return result.map(c => c.trim());
}

async function exportToCSV() {
    console.log("Export process started");
    const result = await storage.get([
        'calendarEvents', 'projects', ALL_DAY_DETAILS_KEY
    ]);
    console.log("Data fetched from storage for export");
    
    const localCalendarEvents = result.calendarEvents || [];
    const localProjects = result.projects || [];
    const localAllDayDetails = result[ALL_DAY_DETAILS_KEY] || {};
    
    const projectMap = {};
    localProjects.forEach(project => {
        projectMap[project.id] = project.name;
    });

    let allDatesSet = new Set(localCalendarEvents.map(ev => ev.date));
    Object.keys(localAllDayDetails).forEach(dateStr => allDatesSet.add(dateStr));
    let uniqueDates = Array.from(allDatesSet).sort();

    let header = [
        "Дата", "День недели",
        "Калории утром", "Калории днем", "Калории вечером", "Комментарий дня",
        "События", "Проекты"
    ];

    let csvContent = '\uFEFF' + header.join(';') + '\n';

    uniqueDates.forEach(dateStr => {
        let dateObj = new Date(dateStr + "T00:00:00");
        let dayOfWeek = dateObj.toLocaleDateString('ru-RU', { weekday: "short" });
        const details = localAllDayDetails[dateStr] || {};
        const cals = details.calories || {};

        const events = localCalendarEvents
            .filter(ev => ev.date === dateStr && ev.type === 'event')
            .map(ev => {
                const start = new Date(ev.startTime);
                const end = new Date(ev.endTime);
                const durationMinutes = Math.round((end - start) / 60000);
                return {
                    title: ev.title,
                    description: ev.description || '',
                    startTime: ev.startTime,
                    endTime: ev.endTime,
                    duration: durationMinutes,
                    projectName: ev.projectId ? (projectMap[ev.projectId] || 'Unknown Project') : null,
                    type: ev.type
                };
            });

        const projectsData = localCalendarEvents // Renamed to avoid conflict with global `projects`
            .filter(ev => ev.date === dateStr && ev.type === 'project')
            .map(ev => {
                const start = new Date(ev.startTime);
                const end = new Date(ev.endTime);
                const durationMinutes = Math.round((end - start) / 60000);
                return {
                    title: ev.title,
                    description: ev.description || '',
                    startTime: ev.startTime,
                    endTime: ev.endTime,
                    duration: durationMinutes,
                    projectName: ev.projectId ? (projectMap[ev.projectId] || 'Unknown Project') : null,
                    type: ev.type
                };
            });

        const eventsJsonString = events.length > 0 ?
            JSON.stringify(events).replace(/"/g, '""') :
            '[]';
        const projectsJsonString = projectsData.length > 0 ? // Use projectsData
            JSON.stringify(projectsData).replace(/"/g, '""') :
            '[]';

        let row = [
            `"${dateStr}"`,
            `"${dayOfWeek}"`,
            `"${cals.morning || 0}"`,
            `"${cals.afternoon || 0}"`,
            `"${cals.evening || 0}"`,
            `"${(details.comment || '').replace(/"/g, '""')}"`,
            `"${eventsJsonString}"`,
            `"${projectsJsonString}"`
        ];
        csvContent += row.join(';') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calendar_data_${formatDate(new Date()).replace(/-/g, '')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    console.log("Export completed");
}
function updateCurrentTimeIndicator() {
    const now = new Date();
    const currentDay = now.getDay(); // 0 for Sunday, 1 for Monday, etc.
    const dayIndex = (currentDay === 0) ? 6 : currentDay - 1; // Adjust to 0 for Monday, 6 for Sunday if week starts Monday

    const existingIndicator = document.querySelector('.current-time-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Ищем колонку для текущего дня
    const dayColumn = document.querySelector(`.day-column:nth-child(${dayIndex + 1})`);
    if (!dayColumn) return; // Если колонка не найдена, просто выходим из функции

    const indicator = document.createElement('div');
    indicator.className = 'current-time-indicator';

    const totalMinutesInDay = now.getHours() * 60 + now.getMinutes();
    const columnHeight = dayColumn.offsetHeight;
    const position = (totalMinutesInDay / (24 * 60)) * columnHeight;

    indicator.style.top = `${position}px`;
    dayColumn.appendChild(indicator);
}


// --- ИСПРАВЛЕННАЯ ФУНКЦИЯ ---

function updateStopwatchUI() {
    // ИЗМЕНЕНО: ID 'stopwatch-display' заменен на 'sidebar-timer-display'
    const stopwatchDisplay = document.getElementById('sidebar-timer-display'); 
    
    if (!stopwatchDisplay) {
        // Добавим лог ошибки, чтобы в будущем было легче отлаживать
        console.error("Элемент для отображения таймера ('sidebar-timer-display') не найден!");
        return;
    }

    let displayTime = '00:00:00';
    if (stopwatch.isRunning && stopwatch.startTimestamp) {
        const now = Date.now();
        const elapsed = now - stopwatch.startTimestamp;
        const totalSeconds = Math.floor(elapsed / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        displayTime = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    stopwatchDisplay.textContent = displayTime;

    // Этот блок кода ищет элемент для отображения имени проекта.
    // В вашем HTML его нет, но если добавите, он будет работать.
    const stopwatchProjectDisplay = document.getElementById('stopwatch-project-name');
    if (stopwatchProjectDisplay) {
        if (stopwatch.isRunning && stopwatch.projectId) {
            const project = projects.find(p => p.id === stopwatch.projectId);
            stopwatchProjectDisplay.textContent = project ? `Проект: ${project.name}` : "Проект не выбран";
        } else {
            stopwatchProjectDisplay.textContent = "";
        }
    }
}


function persistStopwatchState() {
    storage.set({ stopwatch: {
        isRunning: stopwatch.isRunning,
        startTimestamp: stopwatch.startTimestamp,
        projectId: stopwatch.projectId,
        liveEventId: stopwatch.liveEventId,
        // ДОБАВЛЕНО: сохраняем флаги синхронизации
        isSyncedWithSupabase: stopwatch.isSyncedWithSupabase,
        lastSupabaseSync: stopwatch.lastSupabaseSync
    }});
}
// ==== Функции для работы со секундомером ====

async function syncLiveCalendarEvent() {
    if (!stopwatch.isRunning || !stopwatch.startTimestamp) return;

    const now = new Date();
    const startTimeObj = new Date(stopwatch.startTimestamp);

    // Локальные данные для обновления UI и массива calendarEvents
    const localEventData = {
        id: stopwatch.liveEventId, // На старте это временный ID, потом будет заменен на ID из Supabase
        title: (projects.find(p => p.id === stopwatch.projectId)?.name || 'Работа') + ` (${formatDuration(now - startTimeObj)})`,
        date: getLocalDateString(startTimeObj),
        startTime: localIso(startTimeObj),
        endTime: localIso(now),
        projectId: stopwatch.projectId,
        type: stopwatch.projectId ? 'project' : 'event',
        is_live: true
    };

    // --- Локальное обновление и ререндер ---
    // Это происходит каждую секунду, обеспечивая плавный UI
    const existingEventIndex = calendarEvents.findIndex(ev => ev.id === stopwatch.liveEventId);
    if (existingEventIndex > -1) {
        calendarEvents[existingEventIndex] = { ...calendarEvents[existingEventIndex], ...localEventData };
    } else {
        // Если локального события нет, добавляем его
        calendarEvents.push(localEventData);
    }
    renderEvents(); // Перерисовываем UI мгновенно

    // --- Синхронизация с Supabase ---
    try {
        if (!stopwatch.isSyncedWithSupabase) {
            // Если событие еще не создано в БД
            console.log("[SYNC LIVE EVENT] Создание нового live-события в Supabase...");
            const createdEvent = await db.createCalendarEvent({
                title: localEventData.title,
                date: localEventData.date,
                start_time: localEventData.startTime.split('T')[1],
                end_time: localEventData.endTime.split('T')[1],
                project_id: localEventData.projectId,
                type: localEventData.type,
                is_live: true
            });

            if (createdEvent && createdEvent.id) {
                // Успешно создали! Обновляем ID в локальном состоянии.
                const oldId = stopwatch.liveEventId;
                stopwatch.liveEventId = createdEvent.id; // Заменяем временный ID на настоящий
                stopwatch.isSyncedWithSupabase = true;  // Флаг, что событие создано в БД
                stopwatch.lastSupabaseSync = Date.now(); // Время последней синхронизации с БД

                // Заменяем ID и в локальном массиве событий
                const eventToUpdate = calendarEvents.find(ev => ev.id === oldId);
                if (eventToUpdate) eventToUpdate.id = stopwatch.liveEventId;
                
                persistStopwatchState(); // Сохраняем новое состояние секундомера с настоящим ID
                console.log(`[SYNC LIVE EVENT] Событие создано с ID: ${stopwatch.liveEventId}`);
            } else {
                console.error("[SYNC LIVE EVENT] Не удалось создать live-событие в Supabase.");
                return; // Прерываем, попробуем на следующей итерации
            }
        } else if (Date.now() - stopwatch.lastSupabaseSync > 15000) { // Обновляем БД не чаще чем раз в 15 секунд
            console.log(`[SYNC LIVE EVENT] Периодическое обновление live-события ${stopwatch.liveEventId} в Supabase...`);
            await db.updateCalendarEvent(stopwatch.liveEventId, {
                end_time: localEventData.endTime.split('T')[1]
                // Можно обновлять и title, если нужно
            });
            stopwatch.lastSupabaseSync = Date.now(); // Обновляем время синхронизации
            persistStopwatchState();
            console.log("[SYNC LIVE EVENT] Live-событие обновлено в Supabase.");
        }
    } catch (error) {
        console.error("[SYNC LIVE EVENT] Ошибка при синхронизации с Supabase:", error);
        // В случае ошибки, isSyncedWithSupabase останется false, и мы попробуем создать снова
        stopwatch.isSyncedWithSupabase = false;
    }
}


// Вспомогательная функция для форматирования длительности
function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`;
}

function handleLiveEventExpansion() {
    const liveEventElement = document.querySelector('.calendar-event.live');
    if (liveEventElement) {
        liveEventElement.classList.add('expanded'); // Or some other visual cue
        // Potentially scroll to it if it's off-screen
        // liveEventElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ДОБАВЛЕНО: Общая функция для тика таймера
function tick() {
    updateStopwatchUI();      // Обновляет текстовое поле таймера
    syncLiveCalendarEvent();  // Обновляет визуальное событие в календаре
}

function startStopwatch() {
    if (!stopwatch.isRunning) {
        stopwatch.isRunning = true;
        stopwatch.startTimestamp = Date.now();
        stopwatch.projectId = selectedProjectId;
        stopwatch.liveEventId = `local-live-${stopwatch.startTimestamp}`;
        stopwatch.isSyncedWithSupabase = false;
        stopwatch.lastSupabaseSync = 0;

        persistStopwatchState();
        
        // ИЗМЕНЕНО: Вызываем tick() сразу и ставим его в интервал
        tick();
        stopwatchInterval = setInterval(tick, 1000);

        // Visually update stopwatch controls
        const startBtn = document.getElementById('start-pomodoro');
        const pauseBtn = document.getElementById('pause-pomodoro');
        if (startBtn) startBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = false;
    }
}

async function stopOrPauseStopwatch(isStoppingCompletely = true) {
    if (!stopwatch.isRunning) return;

    // Сначала останавливаем интервал, чтобы избежать гонки состояний
    clearInterval(stopwatchInterval);
    stopwatchInterval = null;
    stopwatch.isRunning = false;

    const finalEndTime = new Date();
    const finalEventTitle = (projects.find(p => p.id === stopwatch.projectId)?.name || 'Работа') + ` (${formatDuration(finalEndTime - stopwatch.startTimestamp)})`;

    // Финализация события в БД
    if (stopwatch.isSyncedWithSupabase && stopwatch.liveEventId) {
        console.log(`[FINALIZE EVENT] Финализация события ${stopwatch.liveEventId} в Supabase...`);
        try {
            await db.updateCalendarEvent(stopwatch.liveEventId, {
                title: finalEventTitle,
                end_time: localIso(finalEndTime).split('T')[1],
                is_live: false // <-- Самое важное!
            });
            console.log(`[FINALIZE EVENT] Событие успешно финализировано.`);
        } catch (error) {
            console.error(`[FINALIZE EVENT] Ошибка при финализации события:`, error);
        }
    } else if (stopwatch.liveEventId.startsWith('local-live-')) {
        console.log("[FINALIZE EVENT] Создание финализированного события, которое не успело синхронизироваться...");
        try {
            await db.createCalendarEvent({
                title: finalEventTitle,
                date: getLocalDateString(new Date(stopwatch.startTimestamp)),
                start_time: localIso(new Date(stopwatch.startTimestamp)).split('T')[1],
                end_time: localIso(finalEndTime).split('T')[1],
                project_id: stopwatch.projectId,
                type: stopwatch.projectId ? 'project' : 'event',
                is_live: false
            });
             console.log(`[FINALIZE EVENT] Несинхронизированное событие создано как финализированное.`);
        } catch (error) {
             console.error(`[FINALIZE EVENT] Ошибка при создании финализированного события:`, error);
        }
    }

    // Обновляем локальные данные. Загрузка всех событий надежнее.
    // await loadEvents(currentWeekStart);
    // Обновляем локальные данные
    const event = calendarEvents.find(ev => ev.id === stopwatch.liveEventId);
    if (event) {
        event.endTime = localIso(finalEndTime);
        event.is_live = false; 
        event.isLive = false;  // Добавленная строка
        renderEvents();
    }


    // Сбрасываем состояние секундомера, если это полный стоп
    if (isStoppingCompletely) {
        stopwatch.startTimestamp = null;
        stopwatch.projectId = null;
        stopwatch.liveEventId = null;
        stopwatch.isSyncedWithSupabase = false;
        stopwatch.lastSupabaseSync = 0;
    }

    // ИЗМЕНЕНО: Обновляем UI после всех операций
    updateStopwatchUI(); 
    persistStopwatchState();

    // Обновляем кнопки
    const startBtn = document.getElementById('start-pomodoro');
    const pauseBtn = document.getElementById('pause-pomodoro');
    if (startBtn) startBtn.disabled = stopwatch.isRunning;
    if (pauseBtn) pauseBtn.disabled = !stopwatch.isRunning;
}

// Старые функции теперь просто вызывают новую общую функцию
function pauseStopwatch() {
    stopOrPauseStopwatch(false); // Пауза - это не полный стоп
}

function stopStopwatch() {
    stopOrPauseStopwatch(true); // Стоп - это полный сброс
}


async function loadStopwatchState() {
    const result = await storage.get('stopwatch');
    if (result.stopwatch) {
        stopwatch = result.stopwatch;
        if (stopwatch.isRunning) {
            startStopwatch();
        } else {
            updateStopwatchUI();
        }
    }
}

async function loadProjects() {
    const result = await storage.get('projects');
    projects = result.projects || [];
    console.log('Projects loaded:', projects);
    renderProjectSelectAndList();
}

async function loadEvents(forWeekStart) {
    const weekStart = forWeekStart || currentWeekStart;
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    const result = await storage.get('calendarEvents');
    const allEvents = result.calendarEvents || [];
    
    calendarEvents = allEvents.filter(event => {
        const eventDate = new Date(event.date);
        return eventDate >= weekStart && eventDate <= weekEnd;
    });
    
    renderEvents();
}

// ==== Day Detail Modal Functions ====

// Эта функция будет вызываться при клике на заголовок дня
async function openDayDetailModal(dateStr) {
    if (!dayDetailModal || !dayDetailModalDateDisplay || !caloriesMorningInput || !caloriesAfternoonInput || !caloriesEveningInput || !commentInput) return;

    // 1. Устанавливаем дату в заголовок (или скрытый элемент) модального окна,
    // чтобы потом знать, какой день сохранять.
    dayDetailModalDateDisplay.textContent = dateStr;

    // 2. Получаем данные для этого дня. Сначала смотрим в локальный кэш `allDayDetailsData`.
    // Это ускоряет открытие и использует уже загруженные данные.
    const detailsFromCache = allDayDetailsData[dateStr] || {};
    const caloriesFromCache = detailsFromCache.calories || {};

    console.log(`[openDayDetailModal] Opening for ${dateStr}. Details from cache:`, detailsFromCache);

    // 3. Заполняем поля модального окна данными из кэша (или пустыми значениями, если в кэше ничего нет).
    caloriesMorningInput.value = caloriesFromCache.morning || '';
    caloriesAfternoonInput.value = caloriesFromCache.afternoon || '';
    caloriesEveningInput.value = caloriesFromCache.evening || '';
    commentInput.value = detailsFromCache.comment || '';

    // 4. Обновляем счетчик калорий
    updateTotalCaloriesDisplay();

    // 5. Показываем модальное окно
    dayDetailModal.style.display = 'block';

    // 6. Опционально (для 100% гарантии актуальности): Асинхронно запросить свежие данные
    // и обновить поля, если они отличаются от кэша.
    // Это полезно, если данные могли быть изменены в другом окне/устройстве.
    try {
        const freshDetails = await db.getDayDetails(dateStr);
        if (freshDetails) {
            allDayDetailsData[dateStr] = freshDetails; // Обновляем кэш
            const freshCalories = freshDetails.calories || {};
            // Если модальное окно все еще открыто для той же даты, обновляем поля
            if (dayDetailModal.style.display === 'block' && dayDetailModalDateDisplay.textContent === dateStr) {
                console.log(`[openDayDetailModal] Fresh details loaded and applied for ${dateStr}`);
                caloriesMorningInput.value = freshCalories.morning || '';
                caloriesAfternoonInput.value = freshCalories.afternoon || '';
                caloriesEveningInput.value = freshCalories.evening || '';
                commentInput.value = freshDetails.comment || '';
                updateTotalCaloriesDisplay();
            }
        }
    } catch (error) {
        console.error(`[openDayDetailModal] Failed to fetch fresh details for ${dateStr}:`, error);
    }
}

function closeDayDetailModal() {
    if (dayDetailModal) {
        dayDetailModal.style.display = 'none';
    }
    // Не нужно очищать поля, openDayDetailModal будет их заполнять заново при следующем открытии.
}

// Эта функция должна вызываться при сохранении
async function saveDayDetails(date, detailsToSave) {
    const result = await storage.get(ALL_DAY_DETAILS_KEY);
    const allDayDetails = result[ALL_DAY_DETAILS_KEY] || {};
    allDayDetails[date] = detailsToSave;
    await storage.set({ [ALL_DAY_DETAILS_KEY]: allDayDetails });
    allDayDetailsData = allDayDetails;
    updateTotalCaloriesDisplay();
}

// Функция для динамического подсчета калорий в модальном окне
function updateTotalCaloriesDisplay() {
    if (!elements.totalCaloriesValueSpan || !elements.caloriesMorningInput || 
        !elements.caloriesAfternoonInput || !elements.caloriesEveningInput) return;
    
    const morning = parseInt(elements.caloriesMorningInput.value) || 0;
    const afternoon = parseInt(elements.caloriesAfternoonInput.value) || 0;
    const evening = parseInt(elements.caloriesEveningInput.value) || 0;
    elements.totalCaloriesValueSpan.textContent = (morning + afternoon + evening).toString();
}

async function loadDayDetails() {
    const result = await storage.get(ALL_DAY_DETAILS_KEY);
    allDayDetailsData = result[ALL_DAY_DETAILS_KEY] || {};
    updateTotalCaloriesDisplay();
}
/* ============================================= */
/* ===       ОТРИСОВКА СОБЫТИЙ (ВАЖНО!)       === */
/* ============================================= */
function renderEvents() {
    const weekGridContainer = document.getElementById('week-grid');
    if (!weekGridContainer) return;

    // Очищаем старые события
    weekGridContainer.querySelectorAll('.calendar-event').forEach(el => el.remove());

    const weekDates = getWeekDates(currentWeekStart);

    // --- 1. Отрисовка ОБЫЧНЫХ и ПРОЕКТНЫХ событий ---
    calendarEvents
        .filter(event => event.type !== 'regular' && weekDates.some(d => formatDate(d) === event.date))
        .forEach(event => {
            const dayColumn = weekGridContainer.querySelector(`.day-column[data-date="${event.date}"]`);
            if (!dayColumn) return;

            let startTime, endTime;
            try {
                startTime = localToDate(event.startTime);
                endTime = localToDate(event.endTime);
            } catch (e) { return; }
            if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return;

            const hourCell = dayColumn.querySelector('.hour-cell');
            if (!hourCell) return;
            const HOUR_CELL_HEIGHT = hourCell.offsetHeight;
            const PIXELS_PER_MINUTE = HOUR_CELL_HEIGHT / 60;

            const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
            let durationMinutes = Math.round((endTime - startTime) / 60000);
            if (durationMinutes < 1) durationMinutes = 1;
            const topPosition = startMinutes * PIXELS_PER_MINUTE;
            const height = durationMinutes * PIXELS_PER_MINUTE;

            const eventElement = document.createElement('div');
            let classList = ['calendar-event'];
            if (event.type === 'project') classList.push('project-event');
            if (event.is_live) classList.push('live');
            eventElement.className = classList.join(' ');

            if (event.projectId) {
                const project = projects.find(p => p.id === event.projectId);
                if (project && project.color) {
                    eventElement.style.backgroundColor = project.color;
                }
            }

            eventElement.dataset.eventId = event.id;
            eventElement.style.position = 'absolute';
            eventElement.style.top = `${topPosition}px`;
            eventElement.style.height = `${Math.max(height, 15)}px`;
            eventElement.style.left = '2px';
            eventElement.style.right = '2px';
            
            eventElement.innerHTML = `<div class="event-title">${event.title}</div>`;
            eventElement.addEventListener('click', () => openEventModal(event.id));

            dayColumn.appendChild(eventElement);
        });

    // --- 2. Генерация и отрисовка РЕГУЛЯРНЫХ событий ---
    weekDates.forEach(date => {
        const dayOfWeek = date.getDay();
        const dateStr = formatDate(date);
        
        regularEventsConfig.forEach(config => {
            if (!config || !config.days || !config.startTime || !config.endTime) {
                console.warn('Пропущено регулярное событие: некорректная конфигурация', config);
                return;
            }

            if (config.days.includes(dayOfWeek)) {
                const [startHour, startMinute] = config.startTime.split(':').map(Number);
                const [endHour, endMinute] = config.endTime.split(':').map(Number);
                const eventStartTime = new Date(dateStr + 'T' + config.startTime);
                const eventEndTime = new Date(dateStr + 'T' + config.endTime);

                const instanceId = `reg-${config.id}-${dateStr}`;
                const existingEvent = calendarEvents.find(ev => ev.id === instanceId);
                const isCompleted = existingEvent ? existingEvent.completed : false;

                const dayColumn = weekGridContainer.querySelector(`.day-column[data-date="${dateStr}"]`);
                if (!dayColumn) return;

                const hourCell = dayColumn.querySelector('.hour-cell');
                if (!hourCell) return;
                const HOUR_CELL_HEIGHT = hourCell.offsetHeight;
                const PIXELS_PER_MINUTE = HOUR_CELL_HEIGHT / 60;
                
                const startMinutes = startHour * 60 + startMinute;
                const endMinutes = endHour * 60 + endMinute;
                const durationMinutes = endMinutes - startMinutes;
                
                const topPosition = startMinutes * PIXELS_PER_MINUTE;
                const height = durationMinutes * PIXELS_PER_MINUTE;

                const eventElement = document.createElement('div');
                eventElement.className = 'calendar-event regular';
                
                const now = new Date();
                
                // Новая логика окрашивания
                if (isCompleted) {
                    // Если выполнено - всегда добавляем класс 'completed' (сделает зеленым)
                    eventElement.classList.add('completed');
                } else if (now > eventStartTime) {
                    // Если не выполнено И время прошло - добавляем класс 'not-completed' (сделает красным)
                    eventElement.classList.add('not-completed');
                } else {
                    // Если не выполнено И время еще не наступило - оставляем серым (базовый класс regular)
                    eventElement.classList.remove('completed', 'not-completed');
                }
                
                eventElement.style.position = 'absolute';
                eventElement.style.top = `${topPosition}px`;
                eventElement.style.height = `${Math.max(height, 15)}px`;
                eventElement.style.left = '2px';
                eventElement.style.right = '2px';
                eventElement.style.display = 'flex';
                eventElement.style.alignItems = 'center';

                eventElement.innerHTML = `
                    <div class="event-title regular-title">${config.name}</div>
                    <div class="event-time">${config.startTime} - ${config.endTime}</div>
                `;
                
                // При клике на само событие будем открывать модальное окно
                eventElement.addEventListener('click', () => {
                    openEventModal(instanceId);
                });
                dayColumn.appendChild(eventElement);
            }
        });
    });
}


/* ============================================= */
/* === ФУНКЦИЯ НАЧАЛЬНОЙ ЗАГРУЗКИ (ВАЖНО!)    === */
/* ============================================= */
async function initialLoad() {
    console.log('[INITIAL LOAD] Начало initialLoad...');
    
    // Проверка DOM до загрузки данных
    console.log('=== Проверка DOM до загрузки данных ===');
    console.log('regular-event-time:', document.getElementById('regular-event-time'));
    
    try {
        const storageData = await storage.get(['selectedProjectId', 'regularEventsConfig']);
        selectedProjectId = storageData.selectedProjectId || null;
        regularEventsConfig = storageData.regularEventsConfig || [];
        console.log('[INITIAL LOAD] Загружены конфигурации регулярных событий:', regularEventsConfig.length);
        
        // Проверка DOM после загрузки из storage
        console.log('=== Проверка DOM после загрузки из storage ===');
        console.log('regular-event-time:', document.getElementById('regular-event-time'));
        
        await loadProjects();
        await loadEvents(currentWeekStart);
        await loadDayDetails();
        
        // Проверка DOM после загрузки всех данных
        console.log('=== Проверка DOM после загрузки всех данных ===');
        console.log('regular-event-time:', document.getElementById('regular-event-time'));
        
        renderWeekGrid(currentWeekStart);
        renderTimeSlots();
        renderDaysHeader(currentWeekStart);
        renderProjectSelectAndList();
        renderProjectsList();
        renderProjectStats(selectedProjectId);
        
        // Проверка DOM после рендеринга
        console.log('=== Проверка DOM после рендеринга ===');
        console.log('regular-event-time:', document.getElementById('regular-event-time'));
        
        scrollToWorkingHours();
        updateCurrentTimeIndicator();
        
        console.log('[INITIAL LOAD] initialLoad завершен.');
    } catch (error) {
        console.error('[INITIAL LOAD] Ошибка при загрузке:', error);
    }
}

function renderWeekGrid(weekStart) {
    const weekGrid = document.getElementById('week-grid');
    if (!weekGrid) {
        console.error("Не найден элемент #week-grid");
        return;
    }

    weekGrid.innerHTML = '';
    const weekDates = getWeekDates(weekStart);
    
    // Создаем колонки для каждого дня недели
    weekDates.forEach(date => {
        const dayColumn = document.createElement('div');
        dayColumn.className = 'day-column';
        dayColumn.setAttribute('data-date', formatDate(date));
        
        // Создаем ячейки для каждого часа
        for (let hour = 0; hour <= 23; hour++) {
            const hourCell = document.createElement('div');
            hourCell.className = 'hour-cell';
            hourCell.setAttribute('data-hour', hour.toString());
            
            // ДОБАВЛЕНО: Обработчик клика для создания нового события
            hourCell.addEventListener('click', (e) => {
                // Проверяем, не было ли клика по существующему событию
                if (e.target.closest('.calendar-event')) {
                    return; // Если клик был по событию, не создаем новое
                }
                
                const dateStr = dayColumn.getAttribute('data-date');
                openEventModal(null, dateStr, hour);
            });
            
            dayColumn.appendChild(hourCell);
        }
        
        weekGrid.appendChild(dayColumn);
    });

    // Теперь нужно создать временные метки
    const timeSlotsContainer = document.querySelector('.time-slots-container');
    if (timeSlotsContainer) {
        timeSlotsContainer.innerHTML = '';
        for (let hour = 0; hour <= 23; hour++) {
            const timeSlot = document.createElement('div');
            timeSlot.className = 'time-slot';
            timeSlot.textContent = `${pad(hour)}:00`;
            timeSlotsContainer.appendChild(timeSlot);
        }
    }

    renderEvents();
    setTimeout(scrollToWorkingHours, 5);
    updateCurrentTimeIndicator();
}



function renderTimeSlots() {
    const timeSlotsContainer = document.querySelector('.time-slots-container');
    if (!timeSlotsContainer) {
        console.error("Не найден контейнер time-slots-container!");
        return;
    }
    
    timeSlotsContainer.innerHTML = '';
    
    // Генерируем слоты для всех 24 часов
    for (let h = 0; h <= 23; h++) {
        const div = document.createElement('div');
        div.className = 'time-slot';
        div.setAttribute('data-hour', h.toString());
        div.textContent = `${pad(h)}:00`;
        timeSlotsContainer.appendChild(div);
    }
}

function scrollToWorkingHours() {
    const scrollContainer = document.getElementById('week-grid-scroll-container');
    if (!scrollContainer) return;
    
    // Найти 8-часовую ячейку (отсчет с 0)
    const hourCells = document.querySelectorAll('.hour-cell[data-hour="8"]');
    if (hourCells.length > 0) {
        // Берем первую ячейку 8-го часа, если их несколько
        scrollContainer.scrollTop = hourCells[0].offsetTop;
    }
}


// ==== Инициализация ====
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM полностью загружен, начинаем инициализацию...");

    await initialLoad();

    // Слушатель изменений в storage
    storage.onChanged.addListener(async (changes, area) => { // Make listener async
        if (area === "local") {
            let eventsRefreshNeeded = false;
            let projectsRefreshNeeded = false;
            let dayHeadersRefreshNeeded = false;
            let projectStatsRefreshNeeded = false;

            // Этот блок удален, чтобы предотвратить запуск второго таймера.
            // Глобальный объект `stopwatch` уже содержит актуальное состояние.
            /*
            if ('stopwatch' in changes) {
                // Этот вызов приводил к запуску второго таймера и дублированию событий.
                await loadStopwatchState(); 
            }
            */

            if ('calendarEvents' in changes) {
                // Обновляем глобальную переменную из storage, т.к. изменение могло прийти извне
                calendarEvents = changes.calendarEvents.newValue || [];
                console.log("[ON CHANGED] calendarEvents changed, new count:", calendarEvents.length);
                eventsRefreshNeeded = true;
                projectStatsRefreshNeeded = true; 
            }
            if ('projects' in changes) {
                // Используем данные из storage для обновления, так как это источник правды
                projects = changes.projects.newValue || [];
                projectsRefreshNeeded = true;
                projectStatsRefreshNeeded = true; 
            }
            if ('selectedProjectId' in changes) {
                selectedProjectId = changes.selectedProjectId.newValue || null;
                projectStatsRefreshNeeded = true;
                 if (selectProjectSel) selectProjectSel.value = selectedProjectId || "";
            }
            if (ALL_DAY_DETAILS_KEY in changes) {
                allDayDetailsData = changes[ALL_DAY_DETAILS_KEY].newValue || {};
                dayHeadersRefreshNeeded = true;
            }

            // Apply refreshes
            if (projectsRefreshNeeded) {
                renderProjectSelectAndList();
                renderProjectsList();
            }
            if (eventsRefreshNeeded) {
                renderEvents(); // Просто перерисовываем события, а не всю сетку
            }
            if (dayHeadersRefreshNeeded) {
                renderDaysHeader(currentWeekStart);
            }
            if (projectStatsRefreshNeeded) {
                renderProjectStats(selectedProjectId);
            }
        }
    });
}); // Закрываем DOMContentLoaded


// UI / DOM
const timerDisplay = document.getElementById('sidebar-timer-display');
const startBtn = document.getElementById('start-pomodoro');
const pauseBtn = document.getElementById('pause-pomodoro');
const stopBtn = document.getElementById('stop-pomodoro'); // Assuming this is the general stop button
const selectProjectSel = document.getElementById('select-project');
const addProjectBtn = document.getElementById('add-project');
const newProjectNameInput = document.getElementById('project-name');
const projectsListContainer = document.getElementById('projects-list');
const projectStats = document.getElementById('project-stats');
const exportCsvBtn = document.getElementById('export-csv');
const importCsvBtn = document.getElementById('import-csv');
const prevWeekBtn = document.getElementById('prev-week');
const nextWeekBtn = document.getElementById('next-week');
const currentWeekBtn = document.getElementById('current-week');
const openDatePickerBtn = document.getElementById('open-date-picker');
const daysHeaderContainer = document.querySelector('.days-header');
const weekGridContainer = document.querySelector('.week-grid'); // Corrected selector
const timeSlotsContainer = document.querySelector('.time-slots');
const eventModal = document.getElementById('event-modal');
const eventForm = document.getElementById('event-form');
const eventTitleInput = document.getElementById('event-title');
const eventDateInput = document.getElementById('event-date');
const eventStartInput = document.getElementById('event-start');
const eventEndInput = document.getElementById('event-end');
const eventDescriptionInput = document.getElementById('event-description');
const saveEventBtn = document.getElementById('save-event');
const deleteEventBtn = document.getElementById('delete-event');
const cancelEventBtn = document.getElementById('cancel-event');

const datePickerModal = document.getElementById('date-picker-modal');
const calendarGridDom = document.getElementById('calendar-grid');
const monthTitle = document.getElementById('month-title');
const prevMonthBtn = document.getElementById('prev-month');
const nextMonthBtn = document.getElementById('next-month');
const datePickerSelectBtn = document.getElementById('date-picker-select');
const datePickerTodayBtn = document.getElementById('date-picker-today');
const datePickerCancelBtn = document.getElementById('date-picker-cancel');
const weekdayHeader = document.getElementById('weekday-header');
const dayDetailModal = document.getElementById('day-detail-modal');
const dayDetailModalDateDisplay = document.getElementById('day-detail-date');
const caloriesMorningInput = document.getElementById('calories-morning');
const caloriesAfternoonInput = document.getElementById('calories-afternoon');
const caloriesEveningInput = document.getElementById('calories-evening');
const commentInput = document.getElementById('day-comment');
const saveDayDetailsBtn = document.getElementById('save-day-details');
const cancelDayDetailsBtn = document.getElementById('cancel-day-details');
const totalCaloriesValueSpan = document.getElementById('total-calories-value');
const regularEventDetails = document.getElementById('regular-event-details');
const regularEventModalTitle = document.getElementById('regular-event-modal-title');
const regularEventModalStatus = document.getElementById('regular-event-modal-status');
const toggleCompletionBtn = document.getElementById('toggle-completion-btn');
const regularEventCancelBtn = document.getElementById('regular-event-cancel-btn'); // Добавили кнопку отмены



if (regularEventCancelBtn) {
    regularEventCancelBtn.addEventListener('click', closeEventModal);
}

// Event listeners for stopwatch buttons (example)
if (startBtn) {
    startBtn.addEventListener('click', () => {
        // If stopwatch was paused, this might be "Resume"
        // For simplicity, just calling startStopwatch which handles "is not running"
        startStopwatch();
    });
}
if (pauseBtn) {
    pauseBtn.addEventListener('click', pauseStopwatch);
}
if (stopBtn) { // General stop button for the feature / or a dedicated one
    stopBtn.addEventListener('click', () => {
       // Ask user if they want to save the timed event
        if (stopwatch.isRunning || stopwatch.startTimestamp) { // If there's something to stop
            if (confirm("Остановить таймер? Затраченное время будет сохранено как событие. Отмена - продолжить отсчет.")) {
                stopStopwatch(true); // Stop and save
            }
            // else: do nothing, timer continues or remains paused
        }
    });
}


// УНИВЕРСАЛЬНЫЕ ОБРАБОТЧИКИ ЗАКРЫТИЯ МОДАЛЬНЫХ ОКОН
document.querySelectorAll('.modal .close-modal, .date-picker-modal .close-modal, .day-detail-modal .close-modal').forEach(btn => {
    btn.addEventListener('click', function() {
        const modalToClose = this.closest('.modal, .date-picker-modal, .day-detail-modal');
        if (modalToClose) {
            modalToClose.style.display = "none";
            if (modalToClose.id === 'event-modal') {
                closeEventModal();
            }
            if (modalToClose.id === 'day-detail-modal' && dayDetailsManager) {
                dayDetailsManager.closeDayDetailModal();
            }
        }
    });
});

window.addEventListener('click', function(event) {
    [eventModal, datePickerModal, dayDetailModal].forEach(modal => {
        if (modal && event.target === modal) {
            modal.style.display = "none";
            if (modal.id === 'event-modal') closeEventModal();
            if (modal.id === 'day-detail-modal') closeDayDetailModal(); // Используем новую функцию закрытия
        }
    });
});

if (openDatePickerBtn) {
    openDatePickerBtn.addEventListener('click', () => {
       openDatePicker();
    });
}

// ---- Секция с РАНЕЕ УДАЛЕННЫМИ УТИЛИТАМИ ----
// Функции formatDate, pad, getStartOfWeek и т.д. УЖЕ БЫЛИ ОБЪЯВЛЕНЫ В НАЧАЛЕ ФАЙЛА.
// Повторное объявление здесь было бы ошибкой. Я УДАЛИЛ ЭТОТ ДУБЛИРУЮЩИЙ БЛОК.
// function formatDate(date) { ... } // УДАЛЕНО
// function pad(x) { ... } // УДАЛЕНО
// и так далее...
// ---------------------------------------------


// ==== ПРОЕКТЫ ====
function renderProjectSelectAndList() {
    if (selectProjectSel) {
        const currentSelectedVal = selectProjectSel.value;
        selectProjectSel.innerHTML = `<option value="">-- Проект --</option>`;
        projects.forEach(prj => {
            const opt = document.createElement('option');
            opt.value = prj.id;
            opt.textContent = prj.name;
            // if (prj.color) opt.style.backgroundColor = prj.color; // Optional: color code options
            selectProjectSel.appendChild(opt);
        });
        
        // Restore selection
        if (projects.find(p => p.id === currentSelectedVal)) {
            selectProjectSel.value = currentSelectedVal;
        } else if (selectedProjectId && projects.find(p => p.id === selectedProjectId)) {
            selectProjectSel.value = selectedProjectId;
        } else {
             selectProjectSel.value = ""; // Default if no valid selection
        }
    }
    renderProjectsList(); // Call to render the separate list of projects
}

function renderProjectsList() {
    if (projectsListContainer) {
        projectsListContainer.innerHTML = '';
        if (projects.length === 0) {
            projectsListContainer.innerHTML = '<div>Нет проектов. Добавьте новый.</div>';
            return;
        }
        projects.forEach(project => {
            const div = document.createElement('div');
            div.className = 'project-item';
            // div.style.borderLeft = `5px solid ${project.color || '#ccc'}`; // Example with project color
            div.innerHTML = `
                <span class="project-name-display">${project.name}</span>
                <button class="delete-project delete-project-btn" data-id="${project.id}" title="Удалить проект">🗑️</button>
            `;
            // Add click listener to project item to select it (optional UX)
            div.querySelector('.project-name-display').addEventListener('click', () => {
                if (selectProjectSel) selectProjectSel.value = project.id;
                selectedProjectId = project.id;
                storage.set({selectedProjectId});
                renderProjectStats(project.id);
                // Highlight selected project in the list (add a class)
            });
            projectsListContainer.appendChild(div);
        });
    }
}

if (selectProjectSel) {
    selectProjectSel.addEventListener('change', e => {
        const newProjectId = selectProjectSel.value || null; // Handle empty selection

        if (stopwatch.isRunning && stopwatch.projectId && stopwatch.projectId !== newProjectId) {
            if (confirm("Секундомер активен для другого проекта. Остановить текущий отсчет и переключить проект? (ОК для остановки и смены, Отмена для сохранения текущей работы)")) {
                stopStopwatch(true); // Stop and save current tracked time
                selectedProjectId = newProjectId;
                storage.set({selectedProjectId});
                // Update stopwatch's project context IF user decides to immediately start for new project
                // stopwatch.projectId = newProjectId; // This would happen on next startStopwatch()
            } else {
                selectProjectSel.value = stopwatch.projectId; // Revert dropdown to active project
                return; // Don't change selectedProjectId
            }
        } else {
            selectedProjectId = newProjectId;
            storage.set({selectedProjectId});
        }
        renderProjectStats(selectedProjectId);
        updateStopwatchUI(); // To update project name in stopwatch display if any
    });
}

if (projectsListContainer) {
    projectsListContainer.addEventListener('click', async (e) => { // Make async for storage operations
        if (e.target.classList.contains('delete-project-btn')) {
            const id = e.target.getAttribute("data-id");
            const projectToDelete = projects.find(p => p.id === id);
            if (projectToDelete && confirm(`Вы уверены, что хотите удалить проект "${projectToDelete.name}"? Связанные события останутся, но потеряют привязку к проекту.`)) {
                
                // Update projects array
                projects = projects.filter(p => p.id !== id);
                
                // Update calendarEvents: remove projectId from associated events
                calendarEvents.forEach(ev => {
                    if (ev.projectId === id) {
                        ev.projectId = null;
                    }
                });

                if (selectedProjectId === id) {
                    selectedProjectId = null;
                    if (selectProjectSel) selectProjectSel.value = '';
                }
                if (stopwatch.isRunning && stopwatch.projectId === id) {
                    // Decide: stop timer or let it continue without project?
                    if(confirm("Удаляемый проект используется активным таймером. Остановить таймер? (ОК - остановить, Отмена - таймер продолжит без проекта)")) {
                        stopStopwatch(true); // Stop and save
                    } else {
                        stopwatch.projectId = null; // Timer continues without project
                        persistStopwatchState();
                        updateStopwatchUI();
                    }
                }
                
                // Save changes to storage
                storage.set({projects, calendarEvents, selectedProjectId});
                // No need to call render functions if onChanged listener is robust
                // renderProjectSelectAndList();
                // renderProjectStats(selectedProjectId);
                // renderEvents(); // if project colors/styling depends on project existence
            }
        }
    });
}

if (addProjectBtn && newProjectNameInput) {
    addProjectBtn.addEventListener('click', async () => {
        console.log('[ADD PROJECT BTN CLICKED]'); // <--- ДОБАВЬТЕ ЭТОТ ЛОГ
        const projectName = newProjectNameInput.value.trim();
        if (!projectName) {
            alert("Имя проекта не может быть пустым.");
            return;
        }

        // Проверка на существующий проект (по локально загруженным данным)
        if (projects.find(p => p.name.toLowerCase() === projectName.toLowerCase())) {
            alert("Проект с таким именем уже существует (локально). Попробуйте обновить список или выберите другое имя.");
            // Можно добавить здесь await loadProjects(); для актуализации, если есть сомнения
            return;
        }

        console.log(`[ADD PROJECT] Попытка создать проект: "${projectName}"`);
        try {
            // Объект для отправки в Supabase. ID будет сгенерирован Supabase.
            // `color` и другие поля должны соответствовать вашей схеме таблицы 'projects' в Supabase.
            const projectDataForSupabase = {
                name: projectName,
                color: getRandomColor() // Убедитесь, что в таблице есть поле 'color' или удалите это
                // user_id: supabase.auth.user()?.id // Если проекты привязаны к пользователю
            };

            // Вызываем метод из вашего db объекта
            const createdProject = await db.createProject(projectDataForSupabase);

            if (!createdProject || !createdProject.id) {
                alert("Не удалось создать проект. Сервер не вернул данные о созданном проекте.");
                console.error('[ADD PROJECT] Supabase.createProject не вернул ожидаемый объект:', createdProject);
                return;
            }

            console.log('[ADD PROJECT] Проект успешно создан в Supabase:', createdProject);

            // 1. Обновляем локальный список проектов, перезагрузив их все из Supabase.
            // Это самый надежный способ получить актуальное состояние, включая новый проект.
            await loadProjects(); // Эта функция должна обновить глобальную переменную `projects`

            // 2. Очищаем поле ввода
            newProjectNameInput.value = '';

            // 3. Автоматически выбираем новый проект в UI
            selectedProjectId = createdProject.id;
            if (selectProjectSel) {
                selectProjectSel.value = createdProject.id; // Это может не сработать сразу, если renderProjectSelectAndList() еще не вызван с обновленными projects
            }
            // Сохраняем ID выбранного проекта в локальное хранилище,
            // чтобы и другие части приложения знали о выборе, и чтобы сработал onChanged.
            storage.set({ selectedProjectId: createdProject.id });

            // 4. Обновляем UI явно (можно положиться на onChanged, но явный вызов надежнее для немедленного эффекта)
            // renderProjectSelectAndList(); // Вызовется через onChanged или если loadProjects не обновляет UI
            // renderProjectsList();         // Аналогично
            // renderProjectStats(createdProject.id); // Обновить статистику для нового проекта

            // Если loadProjects() не вызывает рендеры и не сохраняет `projects` в storage (чей onChanged бы вызвал рендеры),
            // то нужно вызвать их здесь:
            // renderProjectSelectAndList(); // Должен быть вызван так как projects обновился
            // renderProjectsList();
            // renderProjectStats(selectedProjectId);


        } catch (error) {
            alert(`Ошибка при создании проекта: ${error.message}`);
            console.error('[ADD PROJECT] Ошибка при взаимодействии с Supabase:', error);
        }
    });
}

function getRandomColor() { // Helper for new projects
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function formatTime(totalMinutes) {
    if (!totalMinutes || totalMinutes <= 0) return '0 мин';
    
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    let result = [];
    if (hours > 0) {
        result.push(`${hours} ч`);
    }
    if (minutes > 0) {
        result.push(`${minutes} мин`);
    }
    
    return result.join(' ');
}

function renderProjectStats(projId) {
    if (!projectStats) return;
    
    projectStats.innerHTML = ''; // Очищаем контейнер
    
    if (!projId) {
        projectStats.textContent = 'Проект не выбран.';
        return;
    }
    
    const project = projects.find(p => p.id === projId);
    if (!project) {
        projectStats.textContent = 'Проект не найден.';
        return;
    }

    const todayStr = formatDate(new Date());

    // Общая функция-сумматор для подсчета минут
    const calculateMinutes = (events) => {
        return events.reduce((total, ev) => {
            try {
                // Пропускаем "живые" события, так как их длительность еще не финальная
                if (ev.is_live) return total;
                
                const startTime = localToDate(ev.startTime);
                const endTime = localToDate(ev.endTime);

                if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
                    const duration = Math.max(0, Math.round((endTime - startTime) / 60000));
                    return total + duration;
                }
                return total;
            } catch (e) {
                console.warn("Could not calculate duration for event:", ev);
                return total;
            }
        }, 0);
    };

    // 1. Считаем время за СЕГОДНЯ
    const todaysEvents = calendarEvents.filter(ev => ev.projectId === projId && ev.date === todayStr);
    const todayTotalMinutes = calculateMinutes(todaysEvents);

    // 2. Считаем время за ТЕКУЩУЮ ОТОБРАЖАЕМУЮ НЕДЕЛЮ
    // calendarEvents уже содержит только события текущей недели
    const weeklyEvents = calendarEvents.filter(ev => ev.projectId === projId);
    const weekTotalMinutes = calculateMinutes(weeklyEvents);
    
    // Формируем и выводим HTML
    projectStats.innerHTML = `
        <div class="stats-header"><b>${project.name}</b></div>
        <div class="stats-item">
            <span>За сегодня:</span>
            <span>${formatTime(todayTotalMinutes)}</span>
        </div>
        <div class="stats-item">
            <span>За эту неделю:</span>
            <span>${formatTime(weekTotalMinutes)}</span>
        </div>
    `;
}

function renderDaysHeader(weekStart) {
    if (!daysHeaderContainer) return;
    daysHeaderContainer.innerHTML = '';
    const weekDates = getWeekDates(weekStart);
    const todayStr = formatDate(new Date());

    weekDates.forEach(date => {
        const dateStr = formatDate(date);
        const dayData = allDayDetailsData[dateStr];
        const totalCalories = dayData && dayData.calories ?
            ( (parseInt(dayData.calories.morning) || 0) +
              (parseInt(dayData.calories.afternoon) || 0) +
              (parseInt(dayData.calories.evening) || 0) ) : 0;
        const commentExists = dayData && dayData.comment && dayData.comment.trim() !== '';

        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.setAttribute('data-date', dateStr);
        if (dateStr === todayStr) {
            dayHeader.classList.add('today-header');
        }
        dayHeader.innerHTML = `
            <div class="day-name">${date.toLocaleDateString('ru-RU', { weekday: 'short' })}</div>
            <div.day-date">${pad(date.getDate())}.${pad(date.getMonth() + 1)}</div>
            <div class="day-header-icons">
                <span class="calories-icon" style="display: ${totalCalories > 0 ? 'inline-flex' : 'none'}" title="Калории: ${totalCalories}">
                    🔥 <span class="calories-count">${totalCalories > 0 ? totalCalories : ''}</span>
                </span>
                <span class="comment-icon ${commentExists ? 'has-comment' : ''}" style="display: ${commentExists ? 'inline-flex' : 'none'}" title="Есть комментарий">💬</span>
            </div>
        `;
        dayHeader.addEventListener('click', () => {
            // Вся логика открытия модального окна теперь будет в отдельной функции
            // Мы просто вызываем ее с нужной датой
            openDayDetailModal(dateStr);
        });
        
        daysHeaderContainer.appendChild(dayHeader);
    });
}

// ==== Календарь — выбор даты (Date Picker) ====
let selectedPickerYear = currentDate.getFullYear();
let selectedPickerMonth = currentDate.getMonth();

function openDatePicker() {
    selectedPickerYear = currentDate.getFullYear();
    selectedPickerMonth = currentDate.getMonth();
    if(datePickerModal) {
        datePickerModal.style.display = 'block';
        renderDatePickerCalendar(selectedPickerYear, selectedPickerMonth);
    } else {
        console.error("Date picker modal not found");
    }
}

if(datePickerCancelBtn) datePickerCancelBtn.addEventListener('click', ()=> { if(datePickerModal) datePickerModal.style.display='none'});

if(datePickerTodayBtn) {
    datePickerTodayBtn.addEventListener('click', ()=>{
        const today = new Date();
        currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // Normalized to start of day
        currentWeekStart = getStartOfWeek(currentDate);
        renderDaysHeader(currentWeekStart);
        renderWeekGrid(currentWeekStart);
        if(datePickerModal) datePickerModal.style.display='none';
    });
}
if(datePickerSelectBtn) {
    datePickerSelectBtn.addEventListener('click', ()=>{
        const sel = calendarGridDom ? calendarGridDom.querySelector('.calendar-day.selected') : null;
        if(sel && sel.dataset.date) {
            const datestr = sel.dataset.date;
            currentDate = localToDate(datestr + "T00:00:00"); // Use localToDate or new Date()
            currentWeekStart = getStartOfWeek(currentDate);
            renderDaysHeader(currentWeekStart);
            renderWeekGrid(currentWeekStart);
            if(datePickerModal) datePickerModal.style.display='none';
        } else {
            alert("Дата не выбрана.");
        }
    });
}
if(prevMonthBtn) {
    prevMonthBtn.addEventListener('click', ()=>{
        selectedPickerMonth--;
        if(selectedPickerMonth<0) {selectedPickerMonth=11;selectedPickerYear--;}
        renderDatePickerCalendar(selectedPickerYear, selectedPickerMonth);
    });
}
if(nextMonthBtn) {
    nextMonthBtn.addEventListener('click', ()=>{
        selectedPickerMonth++;
        if(selectedPickerMonth>11) {selectedPickerMonth=0;selectedPickerYear++;}
        renderDatePickerCalendar(selectedPickerYear, selectedPickerMonth);
    });
}

function renderDatePickerCalendar(year, month) {
    if (!monthTitle || !calendarGridDom || !weekdayHeader) {
        console.error("Date picker elements missing for rendering.");
        return;
    }
    monthTitle.textContent = `${new Date(year, month).toLocaleString('ru-RU', { month: 'long' })} ${year}`;
    calendarGridDom.innerHTML = '';

    if (weekdayHeader.children.length === 0) {
         ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d=>weekdayHeader.innerHTML += `<span>${d}</span>`);
    }

    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const todayStr = formatDate(new Date());
    const currentSelectedDateStr = formatDate(currentDate);


    let dayElementsHtml = "";
    let firstDayOfWeek = (firstOfMonth.getDay() + 6) % 7;
    for (let i = 0; i < firstDayOfWeek; i++) {
        dayElementsHtml += `<div class="calendar-day other-month"></div>`;
    }

    for (let day = 1; day <= lastOfMonth.getDate(); day++) {
        let dt = new Date(year, month, day);
        let dateStr = formatDate(dt);
        let classes = 'calendar-day';
        if (dateStr === currentSelectedDateStr) classes += ' selected';
        if (dateStr === todayStr) classes += ' today-picker';
         dayElementsHtml += `<div class="${classes}" data-date="${dateStr}">${day}</div>`;
    }
    calendarGridDom.innerHTML = dayElementsHtml;

    calendarGridDom.querySelectorAll('.calendar-day:not(.other-month)').forEach(dayDiv => {
        dayDiv.addEventListener('click', function() {
            calendarGridDom.querySelectorAll('.calendar-day.selected').forEach(el => el.classList.remove('selected'));
            this.classList.add('selected');
        });
    });
}


// ==== Неделя влево/вправо ====
if(prevWeekBtn) prevWeekBtn.addEventListener('click', ()=>{
    currentDate.setDate(currentDate.getDate()-7);
    currentWeekStart = getStartOfWeek(currentDate); // Recalculate to be sure
    renderDaysHeader(currentWeekStart); renderWeekGrid(currentWeekStart);
});
if(nextWeekBtn) nextWeekBtn.addEventListener('click', ()=>{
    currentDate.setDate(currentDate.getDate()+7);
    currentWeekStart = getStartOfWeek(currentDate);
    renderDaysHeader(currentWeekStart); renderWeekGrid(currentWeekStart);
});
if(currentWeekBtn) currentWeekBtn.addEventListener('click', ()=>{
    currentDate = new Date();
    currentDate.setHours(0,0,0,0); // Normalize
    currentWeekStart = getStartOfWeek(currentDate);
    renderDaysHeader(currentWeekStart); renderWeekGrid(currentWeekStart);
});

// ==== Экспорт / Импорт ====
if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportToCSV);
}

if (importCsvBtn) {
    importCsvBtn.addEventListener('click', async () => {
        let fileInp = document.createElement('input');
        fileInp.type = 'file';
        fileInp.accept = '.csv';
        fileInp.style.display = 'none';

        fileInp.addEventListener('change', function() {
            if (!fileInp.files || fileInp.files.length === 0) {
                if (fileInp.parentNode) fileInp.remove();
                return;
            }

            const selectedFile = fileInp.files[0];
            let reader = new FileReader();

            reader.onload = async function(e) {
                try {
                    let txt = e.target.result;
                    console.log(`Import: Reading file ${selectedFile.name} (${txt.length} bytes)`);

                    if (txt.charCodeAt(0) === 0xFEFF) {
                        txt = txt.slice(1);
                    }

                    const lines = txt.split(/\r\n|\n|\r/).filter(line => line.trim());
                    if (lines.length < 2) {
                        alert("Файл пуст или содержит только заголовки без данных.");
                        if (fileInp.parentNode) fileInp.remove();
                        return;
                    }

                    const headerLine = lines[0];
                    let headerFields;
                    try {
                        // Use parseCSVRow for header as well, in case header fields are quoted
                        headerFields = parseCSVRow(headerLine);
                    } catch (error) {
                        alert("Ошибка при разборе заголовка CSV: " + error.message);
                        if (fileInp.parentNode) fileInp.remove();
                        return;
                    }

                    const headerMap = {};
                    headerFields.forEach((field, index) => {
                        headerMap[field.trim().replace(/^"|"$/g, '')] = index; // Ensure field names are clean
                    });

                    if (!('Дата' in headerMap)) {
                        alert("В CSV файле отсутствует обязательная колонка 'Дата'.");
                        if (fileInp.parentNode) fileInp.remove();
                        return;
                    }

                    console.log("Import: Found headers:", headerMap);

                    let importedCalendarEvents = [];
                    let importedAllDayDetails = {};

                    storage.get(['projects'], (storageData) => {
                        const existingProjects = storageData.projects || [];
                        const projectNameToId = {};
                        existingProjects.forEach(project => {
                            projectNameToId[project.name.toLowerCase()] = project.id; // Use toLowerCase for matching
                        });

                        let newProjects = [];

                        for (let i = 1; i < lines.length; i++) {
                            const line = lines[i].trim();
                            if (!line) continue;

                            // Use robust parseCSVRow for data lines
                            const fields = parseCSVRow(line);

                            if (fields.length < Object.keys(headerMap).length && fields.length < headerFields.length) { // check against original header length too
                                console.warn(`Import: Line ${i+1} has ${fields.length} fields, expected at least ${Math.min(Object.keys(headerMap).length, headerFields.length)}. Line: "${line}"`);
                                continue;
                            }

                            const dateStr = fields[headerMap['Дата']];
                            if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                                console.warn(`Import: Invalid date format in line ${i+1}:`, dateStr);
                                continue;
                            }

                            importedAllDayDetails[dateStr] = {
                                calories: {
                                    morning: parseInt(fields[headerMap['Калории утром']] || '0') || 0,
                                    afternoon: parseInt(fields[headerMap['Калории днем']] || '0') || 0,
                                    evening: parseInt(fields[headerMap['Калории вечером']] || '0') || 0
                                },
                                comment: fields[headerMap['Комментарий дня']] || ''
                            };

                            const safeParseJSON = (jsonString) => {
                                if (!jsonString || jsonString === '[]' || jsonString.trim() === '') return [];
                                try {
                                    let cleaned = jsonString;
                                    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                                        cleaned = cleaned.substring(1, cleaned.length - 1);
                                    }
                                    cleaned = cleaned.replace(/""/g, '"');
                                    return JSON.parse(cleaned);
                                } catch (error) {
                                    console.error("Error parsing JSON:", error, "Original String:", jsonString);
                                    return [];
                                }
                            };

                            const processJsonField = (jsonFieldKey, type) => {
                                if (jsonFieldKey in headerMap) {
                                    const jsonString = fields[headerMap[jsonFieldKey]];
                                    const items = safeParseJSON(jsonString);

                                    if (Array.isArray(items)) {
                                        items.forEach(item => {
                                            if (!item || !item.startTime || !item.endTime) { // Basic validation
                                                console.warn(`Import: Skipping invalid item in ${jsonFieldKey} for date ${dateStr}:`, item);
                                                return;
                                            }
                                            
                                            let projectId = null;
                                            if (item.projectName && item.projectName.toLowerCase() !== 'null' && item.projectName.toLowerCase() !== 'undefined') {
                                                const projNameLower = item.projectName.toLowerCase();
                                                if (projectNameToId[projNameLower]) {
                                                    projectId = projectNameToId[projNameLower];
                                                } else {
                                                    const existingNew = newProjects.find(p => p.name.toLowerCase() === projNameLower);
                                                    if (existingNew) {
                                                        projectId = existingNew.id;
                                                    } else {
                                                        const newPrjId = `prj-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                                                        const newProj = { id: newPrjId, name: item.projectName, color: getRandomColor() };
                                                        newProjects.push(newProj);
                                                        projectNameToId[projNameLower] = newPrjId; // Add to map for subsequent items
                                                        projectId = newPrjId;
                                                    }
                                                }
                                            }

                                            importedCalendarEvents.push({
                                                id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                                                title: item.title || 'Без названия',
                                                description: item.description || '',
                                                date: dateStr,
                                                startTime: item.startTime,
                                                endTime: item.endTime,
                                                projectId: projectId,
                                                type: type,
                                                isLive: false
                                            });
                                        });
                                    }
                                }
                            };

                            processJsonField('События', 'event');
                            processJsonField('Проекты', 'project');
                        }

                        console.log(`Import: Processed ${importedCalendarEvents.length} events and ${Object.keys(importedAllDayDetails).length} days data.`);
                        console.log(`Import: Found ${newProjects.length} new projects to add:`, newProjects.map(p=>p.name));

                        const updatedProjects = [...existingProjects];
                        newProjects.forEach(newProject => {
                            if (!updatedProjects.some(p => p.id === newProject.id || p.name.toLowerCase() === newProject.name.toLowerCase())) {
                                updatedProjects.push(newProject);
                            }
                        });

                        // Ask for confirmation before wiping and importing
                        if (!confirm(`Готовы импортировать ${importedCalendarEvents.length} событий, данные для ${Object.keys(importedAllDayDetails).length} дней и ${newProjects.length} новых проектов? Существующие данные календаря и дней будут ЗАМЕНЕНЫ.`)) {
                            console.log("Import cancelled by user.");
                            if (fileInp.parentNode) fileInp.remove();
                            return;
                        }


                        storage.remove(['calendarEvents', ALL_DAY_DETAILS_KEY], () => {
                            if (chrome.runtime.lastError) {
                                 console.error("Import: Error removing old data:", chrome.runtime.lastError);
                                 alert("Ошибка при удалении старых данных: " + chrome.runtime.lastError.message);
                                 if (fileInp.parentNode) fileInp.remove();
                                 return;
                            }
                            console.log("Import: Old calendar data removed");

                            storage.set({
                                calendarEvents: importedCalendarEvents,
                                [ALL_DAY_DETAILS_KEY]: importedAllDayDetails,
                                projects: updatedProjects // Save combined projects list
                            }, () => {
                                if (chrome.runtime.lastError) {
                                    console.error("Import: Error saving data:", chrome.runtime.lastError);
                                    alert("Ошибка при сохранении импортированных данных: " + chrome.runtime.lastError.message);
                                } else {
                                    console.log("Import: Data saved successfully!");
                                    alert(`Импорт завершен. Импортировано ${importedCalendarEvents.length} событий, данные для ${Object.keys(importedAllDayDetails).length} дней. Добавлено/обновлено проектов. Страница будет перезагружена.`);
                                    window.location.reload();
                                }
                                if (fileInp.parentNode) fileInp.remove();
                            });
                        });
                    }); // end storage.get
                } catch (error) {
                    console.error("Error importing data:", error);
                    alert("Ошибка при импорте данных");
                }
            };

            reader.onerror = (event) => { // Correctly access error from event
                alert("Ошибка чтения файла: " + event.target.error);
                console.error("FileReader error:", event.target.error);
                if (fileInp.parentNode) fileInp.remove();
            };

            reader.readAsText(selectedFile, "UTF-8"); // Specify encoding

        }); // end fileInp.addEventListener('change')

        document.body.appendChild(fileInp); // Add to body to make it clickable in some browsers
        fileInp.click();
        // No need to remove immediately, change handler or new click will handle it
    }); // end importCsvBtn.addEventListener('click')
} // end if (importCsvBtn)

function openEventModal(eventId = null, dateStr = null, hour = null) {
    const eventModalHeader = document.getElementById('event-modal-header'); // <-- внутри функции!
    if (!eventModal || !eventForm || !regularEventDetails || !eventModalHeader) return;
    
    // Сначала скрываем оба блока контента
    eventForm.style.display = 'none';
    regularEventDetails.style.display = 'none';
    editingEventId = eventId;

    // --- Обработка РЕГУЛЯРНЫХ событий ---
    if (eventId && eventId.startsWith('reg-')) {
        // Устанавливаем заголовок для регулярного события
        eventModalHeader.textContent = "Детали регулярного события";

        const [, configId] = eventId.split('-');
        const config = regularEventsConfig.find(c => c.id == configId);
        const eventInstance = calendarEvents.find(ev => ev.id === eventId);
        const isCompleted = eventInstance ? eventInstance.completed : false;

        if (config) {
            regularEventModalTitle.textContent = config.name;
            regularEventModalStatus.textContent = isCompleted ? 'Выполнено' : 'Не выполнено';
            toggleCompletionBtn.textContent = isCompleted ? 'Снять отметку' : 'Отметить как выполненное';

            toggleCompletionBtn.onclick = () => {
                handleRegularEventToggle(eventId, !isCompleted);
                closeEventModal();
            };
        }
        
        regularEventDetails.style.display = 'block';

    // --- Обработка ОБЫЧНЫХ и ПРОЕКТНЫХ событий ---
    } else {
        // Устанавливаем заголовок для обычного события
        eventModalHeader.textContent = eventId ? "Редактировать событие" : "Создать событие";
        
        eventForm.reset(); 

        if (eventId) { // Редактирование
            const event = calendarEvents.find(ev => ev.id === eventId);
            if (event) {
                // ... остальная логика заполнения формы как была ...
                eventTitleInput.value = event.title;
                eventDateInput.value = event.date;
                eventStartInput.value = event.startTime.split('T')[1];
                eventEndInput.value = event.endTime.split('T')[1];
                eventDescriptionInput.value = event.description || "";
                if (selectProjectSel && event.projectId) {
                    selectProjectSel.value = event.projectId;
                }
                deleteEventBtn.style.display = 'inline-block';
            }
        } else { // Создание нового
            // ... остальная логика как была ...
            deleteEventBtn.style.display = 'none';
            // ... и так далее
            eventDateInput.value = dateStr || formatDate(currentDate);
            if (hour !== null) {
                eventStartInput.value = `${pad(hour)}:00`;
                eventEndInput.value = `${pad(hour + 1)}:00`;
            } else {
                const now = new Date();
                eventStartInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
                now.setHours(now.getHours() + 1);
                eventEndInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
            }
        }
        eventForm.style.display = 'block';
    }
    
    eventModal.style.display = 'block';
}


function closeEventModal() {
    if (eventModal) {
        eventModal.style.display = 'none';
    }
    editingEventId = null;
    
    // Очищаем обработчик, чтобы избежать случайных вызовов
    if (toggleCompletionBtn) {
        toggleCompletionBtn.onclick = null;
    }
}

async function saveEvent(eventData) {
    const result = await storage.get('calendarEvents');
    const allEvents = result.calendarEvents || [];
    
    if (eventData.id) {
        const index = allEvents.findIndex(e => e.id === eventData.id);
        if (index !== -1) {
            allEvents[index] = { ...allEvents[index], ...eventData };
        }
    } else {
        eventData.id = Date.now().toString();
        allEvents.push(eventData);
    }
    
    await storage.set({ calendarEvents: allEvents });
    await loadEvents();
}

async function deleteEvent(eventId) {
    const result = await storage.get('calendarEvents');
    const allEvents = result.calendarEvents || [];
    const updatedEvents = allEvents.filter(e => e.id !== eventId);
    await storage.set({ calendarEvents: updatedEvents });
    await loadEvents();
}

// Обновляем обработчик сохранения события
if (saveEventBtn) {
    saveEventBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        const title = eventTitleInput.value.trim();
        const date = eventDateInput.value;
        const startTimeString = eventStartInput.value;
        const endTimeString = eventEndInput.value;
        const description = eventDescriptionInput.value.trim();
        
        if (!title || !date || !startTimeString || !endTimeString) {
            alert("Пожалуйста, заполните название, дату и время начала/окончания.");
            return;
        }
        
        if (endTimeString <= startTimeString) {
            alert("Время окончания должно быть позже времени начала.");
            return;
        }
        
        // Получаем projectId из селекта в модальном окне, если он там есть
        // Или из глобального selectedProjectId, если это новое событие
        let finalProjectId = null;
        const eventProjectSelect = document.getElementById('event-modal-project-select');
        if (eventProjectSelect && eventProjectSelect.value) {
            finalProjectId = eventProjectSelect.value;
        } else if (!editingEventId && selectProjectSel && selectProjectSel.value) {
             finalProjectId = selectProjectSel.value;
        } else if (editingEventId) {
            const currentEvent = calendarEvents.find(ev => ev.id === editingEventId);
            if (currentEvent) finalProjectId = currentEvent.project_id; // Используем project_id из существующего события
        }

        const eventType = finalProjectId ? 'project' : 'event'; // Определяем ТИП ЗДЕСЬ

        const eventDataPayload = {
            id: editingEventId,
            title,
            description,
            date,
            startTime: `${date}T${startTimeString}`,
            endTime: `${date}T${endTimeString}`,
            projectId: finalProjectId,
            type: eventType, // <--- ДОБАВЛЯЕМ ПОЛЕ TYPE
            isLive: false 
        };
        
        // console.log("Собранный eventDataPayload для saveEvent:", eventDataPayload); // Для отладки
        await saveEvent(eventDataPayload);
        closeEventModal();
    });
}
// Обновляем обработчик удаления события
if (deleteEventBtn) {
    deleteEventBtn.addEventListener('click', async () => {
        if (editingEventId && confirm("Вы уверены, что хотите удалить это событие?")) {
            await deleteEvent(editingEventId);
            closeEventModal();
        }
    });
}

if (cancelEventBtn) {
    cancelEventBtn.addEventListener('click', closeEventModal);
}

// Placeholder for DayDetailsManager if you create it as a class
// class DayDetailsManager {
//     constructor() { /* ... */ }
//     openDayDetailModal(dateStr) { /* ... */ }
//     closeDayDetailModal() { /* ... */ }
//     saveDayDetails() { /* ... */ }
// }
// if (!dayDetailsManager) {
//    dayDetailsManager = new DayDetailsManager();
// }


// Обработчик для кнопки сохранения деталей дня
if (saveDayDetailsBtn) {
    saveDayDetailsBtn.addEventListener('click', async () => {
        const dateStr = dayDetailModalDateDisplay.textContent;
        if (!dateStr) {
            alert("Не удалось определить дату дня.");
            return;
        }

        const calories = {
            morning: parseInt(caloriesMorningInput.value) || 0,
            afternoon: parseInt(caloriesAfternoonInput.value) || 0,
            evening: parseInt(caloriesEveningInput.value) || 0,
        };
        const comment = commentInput.value.trim();

        const detailsToSave = {
            calories: calories,
            comment: comment
        };

        await saveDayDetails(dateStr, detailsToSave);
        // После сохранения, обновим локальный кэш allDayDetailsData и UI заголовков дней
        await loadDayDetails();
        renderDaysHeader(currentWeekStart);
        closeDayDetailModal();
    });
}

// Обработчик для кнопки отмены деталей дня
if (cancelDayDetailsBtn) {
    cancelDayDetailsBtn.addEventListener('click', () => {
        closeDayDetailModal();
    });
}

console.log("Main script initialized and listeners attached.");
// НОВАЯ ФУНКЦИЯ для смены статуса из модального окна
async function handleRegularEventToggle(instanceId, newCompletionState) {
    // Найти существующее событие или создать новое для записи статуса
    let event = calendarEvents.find(ev => ev.id === instanceId);

    if (event) {
        event.completed = newCompletionState;
    } else {
        // Если события еще не было в массиве, создаем его
        const [, configId, dateStr] = instanceId.split('-');
        const config = regularEventsConfig.find(c => c.id == configId);
        if (!config) {
            console.error("Не найдена конфигурация для регулярного события:", configId);
            return;
        }

        event = {
            id: instanceId,
            title: config.name,
            date: dateStr,
            type: 'regular',
            completed: newCompletionState,
            startTime: `${dateStr}T${config.time}`,
            endTime: `${dateStr}T${config.time}` // Длительность условна
        };
        calendarEvents.push(event);
    }
    
    // Сохраняем все события в хранилище. onChanged listener перерисует UI.
    storage.set({ calendarEvents });
}


function initializeEventHandlers() {
    // Инициализация DOM элементов
    if (!initializeElements()) {
        console.error('Не удалось инициализировать DOM элементы');
        return;
    }

    // Слушатели событий для калорий
    [elements.caloriesMorningInput, elements.caloriesAfternoonInput, elements.caloriesEveningInput]
        .forEach(input => {
            if (input) input.addEventListener('input', updateTotalCaloriesDisplay);
        });

    // Слушатели событий для кнопок
    if (elements.saveDayDetailsBtn) {
        elements.saveDayDetailsBtn.addEventListener('click', async () => {
            const dateStr = elements.dayDetailModalDateDisplay.textContent;
            if (!dateStr) {
                alert("Ошибка: не удалось определить дату для сохранения.");
                return;
            }

            const detailsPayload = {
                calories: {
                    morning: parseInt(elements.caloriesMorningInput.value, 10) || 0,
                    afternoon: parseInt(elements.caloriesAfternoonInput.value, 10) || 0,
                    evening: parseInt(elements.caloriesEveningInput.value, 10) || 0,
                },
                comment: elements.commentInput.value.trim()
            };

            await saveDayDetails(dateStr, detailsPayload);
            closeDayDetailModal();
        });
    }

    if (elements.cancelDayDetailsBtn) {
        elements.cancelDayDetailsBtn.addEventListener('click', closeDayDetailModal);
    }

    // ... rest of the event handlers ...
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('=== Проверка элементов при инициализации ===');
    console.log('regular-event-time до инициализации:', document.getElementById('regular-event-time'));
    console.log('regular-event-name до инициализации:', document.getElementById('regular-event-name'));
    
    // Проверяем родительский контейнер
    const container = document.querySelector('.regular-event-management');
    console.log('Контейнер регулярных событий:', container);
    if (container) {
        console.log('HTML контейнера:', container.innerHTML);
    }
    
    initializeEventHandlers(); // ЭТОТ ВЫЗОВ ДОЛЖЕН БЫТЬ ПЕРВЫМ
    initialLoad();
    
    // Проверяем состояние после инициализации
    console.log('=== Состояние после инициализации ===');
    console.log('regular-event-time после инициализации:', document.getElementById('regular-event-time'));
    console.log('regular-event-name после инициализации:', document.getElementById('regular-event-name'));
    
    // Проверяем родительский контейнер снова
    const containerAfter = document.querySelector('.regular-event-management');
    console.log('Контейнер регулярных событий после инициализации:', containerAfter);
    if (containerAfter) {
        console.log('HTML контейнера после инициализации:', containerAfter.innerHTML);
    }
});

